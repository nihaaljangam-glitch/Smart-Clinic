/**
 * routers/service.js — Scheduling & queue management (async, MongoDB)
 */

const express = require('express');
const router = express.Router();
const queueService = require('../services/instance');

// POST /service/schedule/:userId — Auto-assign to best staff
router.post('/schedule/:userId', async (req, res) => {
    try {
        const result = await queueService.scheduleUser(req.params.userId);
        res.json({
            message: `${result.user.name} scheduled with ${result.staff.name}`,
            user: result.user,
            assigned_staff: result.staff,
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST /queue/optimize — Recalculate and rebalance all queues
router.post('/queue/optimize', async (_req, res) => {
    try {
        const optimized = await queueService.optimizeQueue();
        res.json({ message: 'Queue optimized', queue_length: optimized.length, queue: optimized });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /cancel/:userId — Cancel a patient
router.post('/cancel/:userId', async (req, res) => {
    try {
        const user = await queueService.cancelUser(req.params.userId);
        res.json({ message: 'Patient cancelled', user });
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
});

// POST /no-show/:userId — Mark as no-show
router.post('/no-show/:userId', async (req, res) => {
    try {
        const user = await queueService.markNoShow(req.params.userId);
        res.json({ message: 'Patient marked as no-show', user });
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
});

// POST /complete/:userId — Mark as completed
router.post('/complete/:userId', async (req, res) => {
    try {
        const user = await queueService.markCompleted(req.params.userId);
        res.json({ message: 'Patient session completed', user });
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
});

// POST /reassign/:userId — Reassign back to general pool
router.post('/reassign/:userId', async (req, res) => {
    try {
        const user = await queueService.reassignUser(req.params.userId);
        res.json({ message: 'Patient reassigned to general pool', user });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});



// POST /emergency/:userId — Emergency override (top of queue)
router.post('/emergency/:userId', async (req, res) => {
    try {
        const user = await queueService.emergencyOverride(req.params.userId);
        res.json({ message: `EMERGENCY: ${user.name} moved to front of queue`, user });
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
});

// GET /stats — Dashboard statistics
router.get('/stats', async (_req, res) => {
    try {
        const stats = await queueService.getStats();
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /service/assign-doctor/:userId/:staffId — Manual Assignment
router.post('/assign-doctor/:userId/:staffId', async (req, res) => {
    try {
        const result = await queueService.assignDoctor(req.params.userId, req.params.staffId);
        res.json({ message: 'Doctor assigned successfully', ...result });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST /queue/optimize — Re-balance queue
router.post('/queue/optimize', async (_req, res) => {
    try {
        const sorted = await queueService.optimizeQueue();
        res.json({ message: 'Optimization success', queue_length: sorted.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
