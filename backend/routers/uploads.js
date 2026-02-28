/**
 * routers/uploads.js — File uploads (async, MongoDB)
 *
 * Uses multer for disk storage. File metadata is saved to MongoDB.
 */

const express = require('express');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const queueService = require('../services/instance');

// ─── Multer — save to uploads/ with unique filenames ─────────
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, path.join(__dirname, '..', 'uploads'));
    },
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${uuidv4()}${ext}`);
    },
});

const fileFilter = (_req, file, cb) => {
    const allowed = [
        'image/jpeg', 'image/png', 'image/gif',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`File type ${file.mimetype} is not allowed`), false);
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } });

// POST /upload/:userId — Upload a file for a patient
router.post('/upload/:userId', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file provided' });

        const meta = await queueService.uploadFile(req.params.userId, req.file);
        res.status(201).json({ message: 'File uploaded', file: meta });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// GET /files/:userId — List all files for a patient
router.get('/files/:userId', async (req, res) => {
    try {
        const files = await queueService.getUserFiles(req.params.userId);
        res.json({ user_id: req.params.userId, files });
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
});

// GET /download/:userId/:fileId — Download a specific file
router.get('/download/:userId/:fileId', async (req, res) => {
    try {
        const meta = await queueService.getFilePath(req.params.userId, req.params.fileId);
        res.download(meta.file_path, meta.filename);
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
});

module.exports = router;
