/**
 * routers/staff.js — Staff management (async, MongoDB)
 */

const express = require('express');
const router = express.Router();
const queueService = require('../services/instance');

// GET /staff — List all staff
// GET /staff — List all staff
router.get('/', async (_req, res) => {
    try {
        const staff = await queueService.listAllStaff();
        res.json({ count: staff.length, staff });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /staff — Add a staff member
// POST /staff — Add a staff member
router.post('/', async (req, res) => {
    try {
        const { name, start_time, end_time } = req.body;
        if (!name || !start_time || !end_time) {
            return res.status(400).json({ error: 'name, start_time, and end_time are required' });
        }
        const staff = await queueService.addStaff({ name, start_time, end_time });
        res.status(201).json({ message: 'Staff member created', staff });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// GET /queue/status/:staffId — Staff queue details
router.get('/queue/status/:staffId', async (req, res) => {
    try {
        const status = await queueService.getStaffQueueStatus(req.params.staffId);
        res.json(status);
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
});

// DELETE /staff/:id — Remove staff member
// DELETE /staff/:id — Remove staff member
router.delete('/:id', async (req, res) => {
    try {
        const result = await queueService.deleteStaff(req.params.id);
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;
