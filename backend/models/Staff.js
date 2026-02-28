/**
 * models/Staff.js — Mongoose Schema for a Staff/Doctor
 */

const mongoose = require('mongoose');

const StaffSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },

        start_time: { type: String, required: true }, // "HH:MM"
        end_time: { type: String, required: true },   // "HH:MM"

        // Ordered list of User ObjectIds currently in this doctor's queue
        queue: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

        // Total assigned service duration in minutes
        workload: { type: Number, default: 0 },

        active: { type: Boolean, default: true },
    },
    { timestamps: true }
);

module.exports = mongoose.model('Staff', StaffSchema);
