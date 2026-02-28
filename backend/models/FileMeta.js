/**
 * models/FileMeta.js — Mongoose Schema for uploaded file metadata
 */

const mongoose = require('mongoose');

const FileMetaSchema = new mongoose.Schema(
    {
        filename: { type: String, required: true },
        content_type: { type: String },
        file_path: { type: String, required: true },

        // Which user this file belongs to
        owner: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },

        upload_time: { type: Date, default: Date.now },
    },
    { timestamps: true }
);

module.exports = mongoose.model('FileMeta', FileMetaSchema);
