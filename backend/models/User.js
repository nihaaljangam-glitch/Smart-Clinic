/**
 * models/User.js — Mongoose Schema for a Patient/User
 */

const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },

        visit_type: {
            type: String,
            enum: ['emergency', 'regular', 'follow_up'],
            default: 'regular',
        },

        priority_level: {
            type: Number,
            min: 1,
            max: 5,
            default: 3,
        },

        estimated_service_time: { type: Number, default: 15 }, // minutes

        arrival_time: { type: Date, default: Date.now },

        assigned_staff_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Staff',
            default: null,
        },

        // Array of FileMeta ObjectIds
        uploaded_files: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FileMeta' }],

        // waiting | scheduled | serving | completed | cancelled | no-show
        status: {
            type: String,
            enum: ['waiting', 'scheduled', 'serving', 'completed', 'cancelled', 'no-show'],
            default: 'waiting',
        },

        // Computed priority score — stored so the queue can be rebuilt quickly
        score: { type: Number, default: 0 },
    },
    { timestamps: true }
);

module.exports = mongoose.model('User', UserSchema);
