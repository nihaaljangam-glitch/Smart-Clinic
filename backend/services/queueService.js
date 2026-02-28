/**
 * services/queueService.js
 *
 * Async QueueService using MongoDB via Mongoose.
 * All methods return Promises. The in-memory Heap is rebuilt from
 * the database on startup and kept in sync after every mutation.
 *
 * Architecture:
 *   - MongoDB is the source of truth for all data.
 *   - The Heap is a runtime index for fast priority ordering.
 */

const { Heap } = require('heap-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Staff, FileMeta, Auth } = require('../models');
const { SECRET_KEY } = require('../middleware/auth');

// ─── Priority Scoring Weights ────────────────────────────────
const PRIORITY_WEIGHT = 10;
const WAITING_TIME_WEIGHT = 2;
const STAFF_WORKLOAD_WEIGHT = 1;
const VISIT_TYPE_BONUS = { emergency: 20, regular: 0, follow_up: -5 };

class QueueService {
    constructor() {
        // Max-heap: higher score served first
        this.heap = new Heap((a, b) => b.score - a.score);
        console.log('[QueueService] Initialized with MongoDB backend');
    }

    // ═══════════════════════════════════════════════════════════
    //  STARTUP — Rebuild the in-memory heap from DB
    // ═══════════════════════════════════════════════════════════

    /**
     * Called once after MongoDB connects. Loads all active users
     * into the in-memory priority heap.
     */
    async init() {
        const activeUsers = await User.find({ status: { $in: ['waiting', 'scheduled'] } }).lean();
        this.heap = new Heap((a, b) => b.score - a.score);

        for (const user of activeUsers) {
            const score = this._calculateScore(user);
            this.heap.push({ user_id: user._id.toString(), score });
        }

        console.log(`[QueueService] Heap rebuilt from DB — ${this.heap.length} active entries`);
    }

    // ═══════════════════════════════════════════════════════════
    //  AUTH & ACCOUNT MANAGEMENT
    // ═══════════════════════════════════════════════════════════

    /**
     * Register a new user (Auth + linked User/Staff)
     */
    async register(data) {
        const { name, email, password, role } = data;

        // Check if email already exists
        const existing = await Auth.findOne({ email });
        if (existing) throw new Error('Email already registered');

        let roleModel = null;
        let linked = null;

        if (role === 'patient') {
            linked = await User.findOne({ name });
            if (!linked) linked = await User.create({ name });
            roleModel = 'User';
        } else if (role === 'staff') {
            linked = await Staff.findOne({ name });
            if (!linked) linked = await Staff.create({ name, start_time: '00:00', end_time: '23:59' });
            roleModel = 'Staff';
        }

        const auth = await Auth.create({
            name,
            email,
            password, // Password hashing should be handled by model or service; Auth.js schema handles it here
            role,
            linked_id: linked ? linked._id : null,
            role_model: roleModel
        });

        const token = jwt.sign({ id: auth._id, role: auth.role }, SECRET_KEY, { expiresIn: '24h' });

        return { auth, token };
    }

    /**
     * Login user
     */
    async login(email, password) {
        const auth = await Auth.findOne({ email });
        if (!auth) throw new Error('Invalid email or password');

        const isMatch = await auth.comparePassword(password);
        if (!isMatch) throw new Error('Invalid email or password');

        const token = jwt.sign({ id: auth._id, role: auth.role }, SECRET_KEY, { expiresIn: '24h' });

        return { auth, token };
    }

    // ═══════════════════════════════════════════════════════════
    //  USER MANAGEMENT
    // ═══════════════════════════════════════════════════════════

    /**
     * Create a new user in MongoDB and push to the priority heap.
     */
    async addUser(data) {
        // Emergency visit type always gets priority 5
        if (data.visit_type === 'emergency') {
            data.priority_level = 5;
        }

        const user = await User.create({
            name: data.name,
            visit_type: data.visit_type || 'regular',
            priority_level: data.priority_level ?? 3,
            estimated_service_time: data.estimated_service_time ?? 15,
            arrival_time: data.arrival_time ? new Date(data.arrival_time) : new Date(),
            status: 'waiting',
        });

        const score = this._calculateScore(user);
        user.score = score;
        await user.save();

        this.heap.push({ user_id: user._id.toString(), score });
        console.log(`[QueueService] User added: ${user.name} — score ${score.toFixed(2)}`);
        return user;
    }

    /**
     * Update a user's priority level and recalculate score.
     */
    async updatePriority(userId, newPriority) {
        if (newPriority < 1 || newPriority > 5) throw new Error('priority_level must be 1–5');

        const user = await User.findById(userId);
        if (!user) throw new Error(`User ${userId} not found`);

        user.priority_level = newPriority;
        user.score = this._calculateScore(user);
        await user.save();

        await this._rebuildHeap();
        console.log(`[QueueService] Priority updated: ${userId} → ${newPriority}`);
        return user;
    }

    /**
     * Get full user status including queue position and estimated wait.
     */
    async getUserStatus(userId) {
        const user = await User.findById(userId).populate('uploaded_files');
        if (!user) throw new Error(`User ${userId} not found`);

        // Queue position in the heap
        const sorted = this.heap.toArray().slice().sort((a, b) => b.score - a.score);
        const position = sorted.findIndex(e => e.user_id === userId.toString()) + 1;

        // Estimate wait = sum of service times ahead in the assigned staff queue
        let estimatedWait = 0;
        if (user.assigned_staff_id) {
            const staff = await Staff.findById(user.assigned_staff_id).populate('queue');
            if (staff) {
                for (const qUser of staff.queue) {
                    if (qUser._id.toString() === userId.toString()) break;
                    estimatedWait += qUser.estimated_service_time || 0;
                }
            }
        }

        return {
            ...user.toObject(),
            queue_position: position > 0 ? position : null,
            estimated_wait_minutes: estimatedWait,
        };
    }

    /**
     * List all users.
     */
    async listAllUsers() {
        return User.find().sort({ score: -1, arrival_time: 1 }).lean();
    }

    // ═══════════════════════════════════════════════════════════
    //  STAFF MANAGEMENT
    // ═══════════════════════════════════════════════════════════

    /**
     * Create a new staff member.
     */
    async addStaff(data) {
        const staff = await Staff.create({
            name: data.name,
            start_time: data.start_time,
            end_time: data.end_time,
            active: true,
        });
        console.log(`[QueueService] Staff added: ${staff.name} (${staff._id})`);
        return staff;
    }

    /**
     * Return all staff members.
     */
    async listAllStaff() {
        return Staff.find().lean();
    }

    /**
     * Return a staff member's queue with patient details.
     */
    async getStaffQueueStatus(staffId) {
        const staff = await Staff.findById(staffId)
            .populate('queue', 'name priority_level status visit_type estimated_service_time')
            .lean();
        if (!staff) throw new Error(`Staff ${staffId} not found`);

        return {
            ...staff,
            queue_details: staff.queue,
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  SERVICE SCHEDULING
    // ═══════════════════════════════════════════════════════════

    /**
     * Assign user to the best available staff member.
     * Best = active + available now + lowest workload.
     */
    async scheduleUser(userId) {
        const user = await User.findById(userId);
        if (!user) throw new Error(`User ${userId} not found`);
        if (['cancelled', 'no-show', 'completed'].includes(user.status)) {
            throw new Error(`Cannot schedule a ${user.status} patient`);
        }

        const staff = await this._findBestStaff();
        if (!staff) throw new Error('No available staff at this time');

        // Update user
        user.assigned_staff_id = staff._id;
        user.status = 'scheduled';
        user.score = this._calculateScore(user);
        await user.save();

        // Update staff
        staff.queue.push(user._id);
        staff.workload += user.estimated_service_time;
        await staff.save();

        await this._rebuildHeap();
        console.log(`[QueueService] Scheduled ${user.name} → ${staff.name} (workload: ${staff.workload} min)`);
        return { user, staff };
    }

    /**
     * Recalculate all scores and rebuild the in-memory heap.
     */
    async optimizeQueue() {
        const activeUsers = await User.find({ status: { $in: ['waiting', 'scheduled'] } });

        for (const user of activeUsers) {
            user.score = this._calculateScore(user);
            await user.save();
        }

        await this._rebuildHeap();
        const sorted = this.heap.toArray().slice().sort((a, b) => b.score - a.score);
        console.log(`[QueueService] Queue optimized — ${sorted.length} entries`);
        return sorted;
    }

    /**
     * Cancel a patient — remove from staff queue, free workload.
     */
    async cancelUser(userId) {
        const user = await User.findById(userId);
        if (!user) throw new Error(`User ${userId} not found`);

        await this._removeFromStaffQueue(user);
        user.status = 'cancelled';
        await user.save();

        await this._rebuildHeap();
        console.log(`[QueueService] Cancelled: ${userId}`);
        return user;
    }

    /**
     * Generic status update
     */
    async updateStatus(userId, status) {
        const user = await User.findById(userId);
        if (!user) throw new Error('User not found');

        const oldStatus = user.status;
        user.status = status;
        await user.save();

        // If transitioning away from active, remove from staff queue
        const activeStatuses = ['waiting', 'scheduled', 'serving'];
        if (activeStatuses.includes(oldStatus) && !activeStatuses.includes(status)) {
            if (user.assigned_staff_id) {
                await this._removeFromStaffQueue(user);
            }
        }

        await this._rebuildHeap();
        return user;
    }

    /**
     * Mark a patient as completed (served)
     */
    async markCompleted(userId) {
        const user = await User.findById(userId);
        if (!user) throw new Error('User not found');

        user.status = 'completed';
        await user.save();

        if (user.assigned_staff_id) {
            await this._removeFromStaffQueue(user);
        }

        await this._rebuildHeap();
        console.log(`[QueueService] User completed: ${user.name}`);
        return user;
    }

    /**
     * Mark a patient as no-show
     */
    async markNoShow(userId) {
        const user = await User.findById(userId);
        if (!user) throw new Error('User not found');

        user.status = 'no-show';
        await user.save();

        if (user.assigned_staff_id) {
            await this._removeFromStaffQueue(user);
        }

        await this._rebuildHeap();
        console.log(`[QueueService] User marked no-show: ${user.name}`);
        return user;
    }

    /**
     * Reassign a patient back to the general queue
     */
    async reassignUser(userId) {
        const user = await User.findById(userId);
        if (!user) throw new Error('User not found');

        // Remove from current staff
        if (user.assigned_staff_id) {
            await this._removeFromStaffQueue(user);
        }

        user.status = 'waiting';
        user.assigned_staff_id = null;
        user.score = this._calculateScore(user);
        await user.save();

        await this._rebuildHeap();
        console.log(`[QueueService] User reassigned to pool: ${user.name}`);
        return user;
    }

    /**
     * Emergency override — push patient to absolute top of queue.
     */
    async emergencyOverride(userId) {
        const user = await User.findById(userId);
        if (!user) throw new Error(`User ${userId} not found`);

        user.priority_level = 5;
        user.visit_type = 'emergency';
        user.score = 9999;
        await user.save();

        await this._rebuildHeap();
        console.log(`[QueueService] EMERGENCY OVERRIDE: ${user.name}`);
        return user;
    }

    /**
     * Dashboard stats.
     */
    async getStats() {
        const [users, staffArr] = await Promise.all([
            User.find().lean(),
            Staff.find().lean(),
        ]);

        const byStatus = { waiting: 0, scheduled: 0, serving: 0, completed: 0, cancelled: 0, 'no-show': 0 };
        let totalWait = 0;
        let activeCount = 0;

        for (const u of users) {
            byStatus[u.status] = (byStatus[u.status] || 0) + 1;
            if (['waiting', 'scheduled'].includes(u.status)) {
                totalWait += (Date.now() - new Date(u.arrival_time).getTime()) / 60000;
                activeCount++;
            }
        }

        return {
            total_users: users.length,
            total_staff: staffArr.length,
            active_staff: staffArr.filter(s => s.active).length,
            users_by_status: byStatus,
            total_workload_minutes: staffArr.reduce((s, st) => s + st.workload, 0),
            average_wait_minutes: activeCount > 0 ? Math.round(totalWait / activeCount) : 0,
            queue_length: this.heap.length,
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  FILE UPLOAD
    // ═══════════════════════════════════════════════════════════

    /**
     * Save file metadata to DB and link to user.
     */
    async uploadFile(userId, file) {
        const user = await User.findById(userId);
        if (!user) throw new Error(`User ${userId} not found`);

        const meta = await FileMeta.create({
            filename: file.originalname,
            content_type: file.mimetype,
            file_path: file.path,
            owner: user._id,
        });

        user.uploaded_files.push(meta._id);
        await user.save();

        console.log(`[QueueService] File uploaded for ${userId}: ${meta.filename}`);
        return meta;
    }

    /**
     * Return all file metadata for a user.
     */
    async getUserFiles(userId) {
        const user = await User.findById(userId);
        if (!user) throw new Error(`User ${userId} not found`);
        return FileMeta.find({ owner: userId }).lean();
    }

    /**
     * Return file metadata for download (validates ownership).
     */
    async getFilePath(userId, fileId) {
        const meta = await FileMeta.findOne({ _id: fileId, owner: userId });
        if (!meta) throw new Error(`File ${fileId} not found or does not belong to this user`);
        return meta;
    }

    // ═══════════════════════════════════════════════════════════
    //  PRIVATE HELPERS
    // ═══════════════════════════════════════════════════════════

    /**
     * Priority scoring formula:
     *   score = (10 × priority) + (2 × wait_min) − (1 × staff_workload) + type_bonus
     */
    _calculateScore(user) {
        const waitMinutes = (Date.now() - new Date(user.arrival_time || Date.now()).getTime()) / 60000;
        const typeBonus = VISIT_TYPE_BONUS[user.visit_type] || 0;

        return (
            PRIORITY_WEIGHT * (user.priority_level || 3) +
            WAITING_TIME_WEIGHT * waitMinutes -
            STAFF_WORKLOAD_WEIGHT * 0 + // workload handled reactively via staff collection
            typeBonus
        );
    }

    /**
     * Rebuild the in-memory heap from active users in the DB.
     */
    async _rebuildHeap() {
        const activeUsers = await User.find({ status: { $in: ['waiting', 'scheduled'] } }).lean();
        this.heap = new Heap((a, b) => b.score - a.score);

        for (const u of activeUsers) {
            this.heap.push({ user_id: u._id.toString(), score: u.score || 0 });
        }
    }

    /**
     * Find the active staff member with the lowest workload whose
     * availability window covers the current local time.
     */
    async _findBestStaff() {
        const allStaff = await Staff.find({ active: true });
        const now = new Date();
        const currentMin = now.getHours() * 60 + now.getMinutes();

        let best = null;
        let lowestWorkload = Infinity;

        for (const s of allStaff) {
            const [sh, sm] = s.start_time.split(':').map(Number);
            const [eh, em] = s.end_time.split(':').map(Number);
            const startMin = sh * 60 + sm;
            const endMin = eh * 60 + em;

            if (currentMin >= startMin && currentMin <= endMin) {
                if (s.workload < lowestWorkload) {
                    lowestWorkload = s.workload;
                    best = s;
                }
            }
        }

        if (!best && allStaff.length > 0) {
            console.warn('[QueueService] No staff found within working hours. Falling back to first available active staff.');
            best = allStaff.sort((a, b) => a.workload - b.workload)[0];
        }

        return best;
    }

    /**
     * Remove user from their assigned staff queue and subtract workload.
     */
    async _removeFromStaffQueue(user) {
        if (user.assigned_staff_id) {
            await Staff.findByIdAndUpdate(user.assigned_staff_id, {
                $pull: { queue: user._id },
                $inc: { workload: -user.estimated_service_time },
            });
            user.assigned_staff_id = null;
        }
    }
}

module.exports = QueueService;
