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
            if (!linked) linked = await User.create({ name, status: 'inactive' });
            roleModel = 'User';
        } else if (role === 'staff' || role === 'admin') {
            linked = await Staff.findOne({ name });
            if (!linked && role === 'staff') {
                linked = await Staff.create({ name, start_time: '00:00', end_time: '23:59' });
            }
            roleModel = role === 'staff' ? 'Staff' : null;
        }

        const auth = await Auth.create({
            name,
            email,
            password,
            role,
            linked_id: linked ? linked._id : null,
            role_model: roleModel
        });

        const token = jwt.sign({ id: auth._id, role: auth.role }, SECRET_KEY, { expiresIn: '24h' });

        return { auth, token };
    }

    /**
     * Create a new user in MongoDB (Admin action).
     * Defaults to inactive unless they are waiting.
     */
    async addUser(data) {
        const user = await User.create({
            name: data.name,
            visit_type: data.visit_type || 'regular',
            priority_level: data.priority_level ?? 3,
            estimated_service_time: data.estimated_service_time ?? 15,
            arrival_time: data.arrival_time ? new Date(data.arrival_time) : new Date(),
            status: data.status || 'inactive',
        });

        if (user.status === 'waiting') {
            const score = this._calculateScore(user);
            user.score = score;
            await user.save();
            this.heap.push({ user_id: user._id.toString(), score });
        }

        return user;
    }

    /**
     * Book an appointment for a user.
     * Transitions inactive patients to the active queue.
     * If preferredDoctorId is given, assigns that doctor directly.
     * Emergency visits auto-allocate to best available doctor.
     */
    async bookAppointment(userId, date, visitType = 'regular', preferredDoctorId = null) {
        const user = await User.findById(userId);
        if (!user) throw new Error(`User ${userId} not found`);

        if (user.status !== 'inactive' && user.status !== 'completed' && user.status !== 'cancelled') {
            throw new Error('User already has an active booking or session');
        }

        user.appointment_date = new Date(date);
        user.arrival_time = new Date();
        user.queue_entry_time = new Date(); // track queue entry separately from account creation
        user.visit_type = visitType;
        user.status = 'waiting';

        // Auto-priority for emergency
        if (visitType === 'emergency') {
            user.priority_level = 5;
        }

        // Store preferred doctor if provided
        if (preferredDoctorId) {
            user.preferred_doctor = preferredDoctorId;
        }

        user.score = this._calculateScore(user);
        await user.save();
        this.heap.push({ user_id: user._id.toString(), score: user.score });

        // Determine doctor to assign
        const doctorToAssign = preferredDoctorId || (user.preferred_doctor ? user.preferred_doctor.toString() : null);

        if (doctorToAssign) {
            // Assign to the preferred doctor
            try {
                await this.assignDoctor(userId, doctorToAssign);
                console.log(`[QueueService] Assigned ${user.name} to preferred doctor ${doctorToAssign}`);
            } catch (err) {
                console.warn(`[QueueService] Preferred doctor assignment failed: ${err.message}. Falling back to auto-assign.`);
                if (visitType === 'emergency') {
                    try { await this.scheduleUser(userId); } catch (e) { /* no staff available */ }
                }
            }
        } else if (visitType === 'emergency') {
            // Auto-assign emergency, no preferred doctor
            try {
                await this.scheduleUser(userId);
            } catch (err) {
                console.warn('[QueueService] Emergency auto-allocation failed:', err.message);
            }
        }

        return await User.findById(userId);
    }

    // ═══════════════════════════════════════════════════════════
    //  USER MANAGEMENT
    // ═══════════════════════════════════════════════════════════

    async addUser(data) {
        const user = await User.create({
            name: data.name,
            visit_type: data.visit_type || 'regular',
            priority_level: data.priority_level ?? 3,
            estimated_service_time: data.estimated_service_time ?? 15,
            arrival_time: data.arrival_time ? new Date(data.arrival_time) : new Date(),
            status: data.status || 'inactive',
        });
        if (user.status === 'waiting') {
            const score = this._calculateScore(user);
            user.score = score;
            await user.save();
            this.heap.push({ user_id: user._id.toString(), score });
        }
        return user;
    }

    async updatePriority(userId, newPriority) {
        if (newPriority < 1 || newPriority > 5) throw new Error('priority_level must be 1–5');
        const user = await User.findById(userId);
        if (!user) throw new Error(`User ${userId} not found`);
        user.priority_level = newPriority;
        user.score = this._calculateScore(user);
        await user.save();
        await this._rebuildHeap();
        return user;
    }

    async updateVisitType(userId, visitType) {
        const user = await User.findById(userId);
        if (!user) throw new Error(`User ${userId} not found`);
        user.visit_type = visitType;
        user.score = this._calculateScore(user);
        await user.save();
        await this._rebuildHeap();
        return user;
    }

    async getUserStatus(userId) {
        const user = await User.findById(userId).populate('uploaded_files');
        if (!user) throw new Error(`User ${userId} not found`);

        // Queue position from the heap (for waiting patients)
        const sorted = this.heap.toArray().slice().sort((a, b) => b.score - a.score);
        const position = sorted.findIndex(e => e.user_id === userId.toString()) + 1;

        // Estimated wait: sum service times of all patients AHEAD in the doctor's queue
        // This is purely based on queue ordering, not elapsed time, so it DECREASES as patients are served.
        let estimatedWait = 0;

        if (['waiting', 'scheduled'].includes(user.status)) {
            if (user.assigned_staff_id) {
                // Use the doctor's actual queue for precision
                const staff = await Staff.findById(user.assigned_staff_id).populate({
                    path: 'queue',
                    select: 'estimated_service_time _id'
                });
                if (staff && staff.queue.length) {
                    for (const qUser of staff.queue) {
                        if (qUser._id.toString() === userId.toString()) break;
                        estimatedWait += (qUser.estimated_service_time || 15);
                    }
                }
            } else {
                // Not yet assigned: estimate by global position × 15 min,
                // BUT subtract time already spent so it trends downward
                const patientsAhead = Math.max(0, (position - 1));
                const rawWait = patientsAhead * 15;
                const minutesInQueue = user.queue_entry_time
                    ? (Date.now() - new Date(user.queue_entry_time).getTime()) / 60000
                    : 0;
                estimatedWait = Math.max(0, Math.round(rawWait - minutesInQueue));
            }
        }

        return {
            ...user.toObject(),
            queue_position: position > 0 ? position : null,
            estimated_wait_minutes: estimatedWait,
        };
    }

    async listAllUsers() {
        return User.find().sort({ score: -1, arrival_time: 1 }).lean();
    }

    async updateHistory(userId, history) {
        const user = await User.findByIdAndUpdate(userId, { medical_history: history }, { new: true });
        if (!user) throw new Error(`User ${userId} not found`);
        return user;
    }

    async updateProfile(userId, data) {
        const { description, profile_image } = data;
        const update = {};
        if (description !== undefined) update.description = description;
        if (profile_image !== undefined) update.profile_image = profile_image;
        const user = await User.findByIdAndUpdate(userId, update, { new: true });
        if (!user) throw new Error(`User ${userId} not found`);
        return user;
    }

    async updateStatus(userId, status) {
        const user = await User.findById(userId);
        if (!user) throw new Error('User not found');
        const oldStatus = user.status;
        user.status = status;
        await user.save();
        const activeStatuses = ['waiting', 'scheduled', 'serving'];
        if (activeStatuses.includes(oldStatus) && !activeStatuses.includes(status)) {
            if (user.assigned_staff_id) await this._removeFromStaffQueue(user);
        }
        await this._rebuildHeap();
        return user;
    }

    // ═══════════════════════════════════════════════════════════
    //  STAFF MANAGEMENT
    // ═══════════════════════════════════════════════════════════

    async addStaff(data) {
        const staff = await Staff.create({
            name: data.name,
            start_time: data.start_time,
            end_time: data.end_time,
            active: true,
        });
        return staff;
    }

    async listAllStaff() {
        return Staff.find().sort({ name: 1 }).lean();
    }

    async deleteStaff(staffId) {
        // Get staff with just the queue IDs (no populate, to avoid stale-doc issues)
        const staff = await Staff.findById(staffId).lean();
        if (!staff) throw new Error(`Staff ${staffId} not found`);

        const patientIds = staff.queue || [];

        // Atomically reassign all patients to waiting pool
        if (patientIds.length > 0) {
            await User.updateMany(
                { _id: { $in: patientIds } },
                { $set: { assigned_staff_id: null, status: 'waiting' } }
            );
            // Recalculate scores for reassigned patients
            const reassigned = await User.find({ _id: { $in: patientIds } });
            for (const u of reassigned) {
                u.score = this._calculateScore(u);
                await u.save();
            }
        }

        // Delete the staff member
        await Staff.findByIdAndDelete(staffId);
        await this._rebuildHeap();

        console.log(`[QueueService] Deleted staff ${staff.name}, reassigned ${patientIds.length} patients`);
        return { message: `${staff.name} deleted. ${patientIds.length} patient(s) returned to queue.` };
    }

    async getStaffQueueStatus(staffId) {
        const staff = await Staff.findById(staffId)
            .populate('queue', 'name priority_level status visit_type estimated_service_time')
            .lean();
        if (!staff) throw new Error(`Staff ${staffId} not found`);
        return { ...staff, queue_details: staff.queue };
    }

    // ═══════════════════════════════════════════════════════════
    //  SERVICE SCHEDULING
    // ═══════════════════════════════════════════════════════════

    async scheduleUser(userId) {
        const user = await User.findById(userId);
        if (!user) throw new Error(`User ${userId} not found`);
        if (['cancelled', 'no-show', 'completed'].includes(user.status)) {
            throw new Error(`Cannot schedule a ${user.status} patient`);
        }
        const staff = await this._findBestStaff();
        if (!staff) throw new Error('No available staff at this time');

        user.assigned_staff_id = staff._id;
        user.status = 'scheduled';
        user.score = this._calculateScore(user);
        await user.save();

        staff.queue.push(user._id);
        staff.workload += user.estimated_service_time;
        await staff.save();

        await this._rebuildHeap();
        return { user, staff };
    }

    async assignDoctor(userId, staffId) {
        const user = await User.findById(userId);
        if (!user) throw new Error(`User ${userId} not found`);

        // Step 1: Remove user from any current doctor's queue (with accurate string-based filter)
        await this._removeFromStaffQueue(user);

        // Step 2: Reload FRESH copies from DB — _removeFromStaffQueue already saved staff changes
        const freshUser = await User.findById(userId);
        const freshStaff = await Staff.findById(staffId);
        if (!freshStaff) throw new Error(`Staff ${staffId} not found`);

        // Step 3: Update user assignment
        freshUser.assigned_staff_id = freshStaff._id;
        freshUser.status = 'scheduled';
        freshUser.score = this._calculateScore(freshUser);
        await freshUser.save();

        // Step 4: Add to staff queue exactly once (freshStaff is post-removal DB state)
        const alreadyInQueue = freshStaff.queue.some(id => id.toString() === userId.toString());
        if (!alreadyInQueue) {
            freshStaff.queue.push(freshUser._id);
            freshStaff.workload += (freshUser.estimated_service_time || 15);
            await freshStaff.save();
        }

        await this._rebuildHeap();
        console.log(`[QueueService] Assigned ${freshUser.name} → ${freshStaff.name} (workload: ${freshStaff.workload}min)`);
        return { user: freshUser, staff: freshStaff };
    }

    async optimizeQueue() {
        const activeUsers = await User.find({ status: { $in: ['waiting', 'scheduled'] } });
        for (const user of activeUsers) {
            user.score = this._calculateScore(user);
            await user.save();
        }
        await this._rebuildHeap();
        const sorted = this.heap.toArray().slice().sort((a, b) => b.score - a.score);
        return sorted;
    }

    async cancelUser(userId) {
        const user = await User.findById(userId);
        if (!user) throw new Error(`User ${userId} not found`);
        await this._removeFromStaffQueue(user);
        user.status = 'cancelled';
        await user.save();
        await this._rebuildHeap();
        return user;
    }

    // ═══════════════════════════════════════════════════════════
    //  AUTH
    // ═══════════════════════════════════════════════════════════

    async login(email, password) {
        const auth = await Auth.findOne({ email });
        if (!auth) throw new Error('Invalid email or password');
        const isMatch = await auth.comparePassword(password);
        if (!isMatch) throw new Error('Invalid email or password');
        const token = jwt.sign({ id: auth._id, role: auth.role }, SECRET_KEY, { expiresIn: '24h' });
        return { auth, token };
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

        const byStatus = { waiting: 0, scheduled: 0, serving: 0, completed: 0, cancelled: 0, 'no-show': 0, booked: 0, follow_up: 0, inactive: 0 };
        let totalRemainingWait = 0;
        let activeCount = 0;

        for (const u of users) {
            byStatus[u.status] = (byStatus[u.status] || 0) + 1;
            if (['waiting', 'scheduled'].includes(u.status)) {
                // Use estimated service time as proxy for remaining wait (not time-already-waited)
                totalRemainingWait += (u.estimated_service_time || 15);
                activeCount++;
            }
        }

        return {
            total_users: users.length,
            total_staff: staffArr.length,
            active_staff: staffArr.filter(s => s.active).length,
            users_by_status: byStatus,
            total_workload_minutes: staffArr.reduce((s, st) => s + st.workload, 0),
            average_wait_minutes: activeCount > 0 ? Math.round(totalRemainingWait / activeCount) : 0,
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
     * Uses String comparison to ensure ObjectId matching works regardless
     * of whether user came from a populated or non-populated query.
     */
    async _removeFromStaffQueue(user) {
        if (!user.assigned_staff_id) return;

        const staffId = user.assigned_staff_id.toString();
        const userId = user._id.toString();

        const staff = await Staff.findById(staffId);
        if (!staff) return;

        // Filter out the user from the queue array (string comparison)
        const originalLen = staff.queue.length;
        staff.queue = staff.queue.filter(id => id.toString() !== userId);
        const removed = originalLen - staff.queue.length;

        // Only decrement workload if we actually removed from the queue
        if (removed > 0) {
            staff.workload = Math.max(0, staff.workload - (user.estimated_service_time || 15));
        }

        await staff.save();
        user.assigned_staff_id = null;

        console.log(`[QueueService] Removed ${user.name || userId} from staff ${staffId} queue (removed ${removed} entry/entries)`);
    }
}

module.exports = QueueService;
