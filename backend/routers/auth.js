/**
 * routers/auth.js — Authentication Router
 */

const express = require('express');
const router = express.Router();
const queueService = require('../services/instance');
const { verifyToken } = require('../middleware/auth');

/**
 * POST /auth/register — Register a new account
 */
router.post('/register', async (req, res) => {
    try {
        const { name, email, password, role } = req.body;
        if (!name || !email || !password || !role) {
            return res.status(400).json({ error: 'All fields (name, email, password, role) are required' });
        }

        const result = await queueService.register({ name, email, password, role });
        res.status(201).json({
            message: 'Registration successful',
            token: result.token,
            user: {
                id: result.auth._id,
                name: result.auth.name,
                email: result.auth.email,
                role: result.auth.role,
                linked_id: result.auth.linked_id
            }
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

/**
 * POST /auth/login — Sign in
 */
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const result = await queueService.login(email, password);
        res.json({
            message: 'Login successful',
            token: result.token,
            user: {
                id: result.auth._id,
                name: result.auth.name,
                email: result.auth.email,
                role: result.auth.role,
                linked_id: result.auth.linked_id
            }
        });
    } catch (err) {
        res.status(401).json({ error: err.message });
    }
});

/**
 * GET /auth/me — Get current user info (protected)
 */
router.get('/me', verifyToken, async (req, res) => {
    res.json({
        user: {
            id: req.auth._id,
            name: req.auth.name,
            email: req.auth.email,
            role: req.auth.role,
            linked_id: req.auth.linked_id
        }
    });
});

module.exports = router;
