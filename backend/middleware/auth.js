/**
 * middleware/auth.js — Authentication and Authorization Middleware
 */

const jwt = require('jsonwebtoken');
const { Auth } = require('../models');

const SECRET_KEY = process.env.JWT_SECRET || 'smart-clinic-super-secret-key';

/**
 * Verify JWT Token
 */
const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        const auth = await Auth.findById(decoded.id);
        if (!auth) {
            return res.status(401).json({ error: 'Invalid token. User not found.' });
        }
        req.auth = auth;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid or expired token.' });
    }
};

/**
 * Check for specific roles
 */
const requireRole = (roles) => {
    return (req, res, next) => {
        if (!req.auth || !roles.includes(req.auth.role)) {
            return res.status(403).json({ error: 'Access denied. Insufficient permissions.' });
        }
        next();
    };
};

module.exports = { verifyToken, requireRole, SECRET_KEY };
