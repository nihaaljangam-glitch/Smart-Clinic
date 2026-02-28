/**
 * routers/users.js — User management (async, MongoDB)
 */

const express = require('express');
const router = express.Router();
const queueService = require('../services/instance');

// GET /users — List all users
router.get('/users', async (_req, res) => {
    try {
        const users = await queueService.listAllUsers();
        res.json({ count: users.length, users });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /users — Create a new patient
router.post('/users', async (req, res) => {
    try {
        const { name, visit_type, priority_level, estimated_service_time, arrival_time } = req.body;
        if (!name) return res.status(400).json({ error: 'name is required' });

        const user = await queueService.addUser({
            name, visit_type, priority_level, estimated_service_time, arrival_time,
        });
        res.status(201).json({ message: 'User created', user });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST /priority/:userId — Update priority
router.post('/priority/:userId', async (req, res) => {
    try {
        const { priority_level } = req.body;
        if (priority_level === undefined) return res.status(400).json({ error: 'priority_level required' });

        const user = await queueService.updatePriority(req.params.userId, Number(priority_level));
        res.json({ message: 'Priority updated', user });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// GET /user/status/:userId — Patient status + queue position
router.get('/user/status/:userId', async (req, res) => {
    try {
        const status = await queueService.getUserStatus(req.params.userId);
        res.json(status);
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
});

module.exports = router;
