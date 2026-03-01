/**
 * routers/users.js — User management (async, MongoDB)
 */

const express = require('express');
const router = express.Router();
const queueService = require('../services/instance');
const { verifyToken } = require('../middleware/auth');

// GET /users — List all users
router.get('/', async (_req, res) => {
    try {
        const users = await queueService.listAllUsers();
        res.json({ count: users.length, users });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /users — Add a new user and immediately queue them (admin action)
router.post('/', async (req, res) => {
    try {
        const { name, visit_type, priority_level, estimated_service_time, preferredDoctorId } = req.body;
        if (!name) return res.status(400).json({ error: 'name is required' });

        // Duplicate guard: block if an active patient with the same name already exists
        const { User } = require('../models');
        const existing = await User.findOne({
            name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
            status: { $in: ['waiting', 'scheduled', 'serving', 'booked'] }
        });
        if (existing) {
            const statusLabel = existing.status.charAt(0).toUpperCase() + existing.status.slice(1);
            return res.status(409).json({
                error: `"${name}" is already in the queue (${statusLabel}). Cannot add a duplicate patient.`,
                existing_id: existing._id,
            });
        }

        // Step 1: Create the user (inactive status)
        const user = await queueService.addUser({
            name: name.trim(), visit_type, priority_level, estimated_service_time,
        });

        // Step 2: Immediately book into queue — makes status 'waiting' or 'scheduled'
        const bookedUser = await queueService.bookAppointment(
            user._id,
            new Date().toISOString(),
            visit_type || 'regular',
            preferredDoctorId || null
        );

        const status = await queueService.getUserStatus(user._id);
        res.status(201).json({
            message: `Patient "${name}" added and queued`,
            user: bookedUser,
            queue_position: status.queue_position,
            estimated_wait_minutes: status.estimated_wait_minutes,
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// PATCH /priority/:userId — Update priority
router.patch('/priority/:userId', async (req, res) => {
    try {
        const { priority_level } = req.body;
        if (priority_level === undefined) return res.status(400).json({ error: 'priority_level required' });

        const user = await queueService.updatePriority(req.params.userId, Number(priority_level));
        res.json({ message: 'Priority updated', user });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// GET /users/status/:userId — Get patient status
router.get('/status/:userId', async (req, res) => {
    try {
        const status = await queueService.getUserStatus(req.params.userId);
        res.json(status);
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
});

// PATCH /users/history — Update medical history
router.patch('/history', verifyToken, async (req, res) => {
    try {
        const { history } = req.body;
        if (!req.auth.linked_id) return res.status(400).json({ error: 'No linked profile found' });
        const user = await queueService.updateHistory(req.auth.linked_id, history);
        res.json({ message: 'History updated', user });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// PATCH /users/profile — Update description and profile image
router.patch('/profile', verifyToken, async (req, res) => {
    try {
        const { description, profile_image } = req.body;
        if (!req.auth.linked_id) return res.status(400).json({ error: 'No linked profile found' });
        const user = await queueService.updateProfile(req.auth.linked_id, { description, profile_image });
        res.json({ message: 'Profile updated', user });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// PATCH /users/visit-type — Update visit category (Patient action)
router.patch('/visit-type', verifyToken, async (req, res) => {
    try {
        const { visit_type } = req.body;
        if (!req.auth.linked_id) return res.status(400).json({ error: 'No linked profile found' });
        const user = await queueService.updateVisitType(req.auth.linked_id, visit_type);
        res.json({ message: 'Visit type updated', user });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// PATCH /users/preferred-doctor/:userId — Set preferred doctor (admin action)
router.patch('/preferred-doctor/:userId', async (req, res) => {
    try {
        const { staffId } = req.body;
        const User = require('../models').User;
        const user = await User.findByIdAndUpdate(
            req.params.userId,
            { preferred_doctor: staffId || null },
            { new: true }
        );
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ message: staffId ? 'Preferred doctor set' : 'Preferred doctor cleared', user });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST /users/book — Book an appointment
router.post('/book', verifyToken, async (req, res) => {
    try {
        const userId = req.auth.linked_id || req.body.userId;
        const { date, visitType, preferredDoctorId } = req.body;
        if (!userId || !date) return res.status(400).json({ error: 'User ID and date required' });
        const user = await queueService.bookAppointment(userId, date, visitType || 'regular', preferredDoctorId || null);
        const status = await queueService.getUserStatus(userId);
        res.json({
            message: 'Appointment booked. You are now in the queue.',
            user,
            queue_position: status.queue_position,
            estimated_wait_minutes: status.estimated_wait_minutes
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// GET /users/files/:userId — List user files
router.get('/files/:userId', verifyToken, async (req, res) => {
    try {
        const files = await queueService.getUserFiles(req.params.userId);
        res.json({ count: files.length, files });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /users/book/:userId — Admin books a patient directly by ID
router.post('/book/:userId', verifyToken, async (req, res) => {
    try {
        const { date, visitType, preferredDoctorId } = req.body;
        const userId = req.params.userId;
        const bookingDate = date || new Date().toISOString();
        const user = await queueService.bookAppointment(userId, bookingDate, visitType || 'regular', preferredDoctorId || null);
        const status = await queueService.getUserStatus(userId);
        res.json({
            message: 'Patient booked into queue.',
            user,
            queue_position: status.queue_position,
            estimated_wait_minutes: status.estimated_wait_minutes
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// PATCH /users/edit/:userId — Admin edits patient visit_type, priority, assigned doctor
router.patch('/edit/:userId', verifyToken, async (req, res) => {
    try {
        const { visit_type, priority_level, staffId } = req.body;
        const userId = req.params.userId;
        const updates = {};
        if (visit_type) updates.visit_type = visit_type;
        if (priority_level) updates.priority_level = parseInt(priority_level);
        const { User } = require('../models');
        const user = await User.findByIdAndUpdate(userId, updates, { new: true });
        if (!user) return res.status(404).json({ error: 'User not found' });
        // Re-score
        user.score = require('../services/instance')._calculateScore ? require('../services/instance')._calculateScore(user) : user.score;
        await user.save();
        // Assign doctor if specified
        if (staffId) {
            await queueService.assignDoctor(userId, staffId);
        }
        await queueService.init(); // rebuild heap
        res.json({ message: 'Patient updated', user });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;
