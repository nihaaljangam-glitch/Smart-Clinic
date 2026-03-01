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

        // When the patient actually entered the active queue (set on booking)
        queue_entry_time: { type: Date, default: null },

        assigned_staff_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Staff',
            default: null,
        },

        // Patient's preferred doctor (set by admin or patient during booking)
        preferred_doctor: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Staff',
            default: null,
        },

        // Array of FileMeta ObjectIds
        uploaded_files: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FileMeta' }],

        // medical history provided by patient
        medical_history: { type: String, default: "" },

        // personal description
        description: { type: String, default: "" },

        // profile image file ID
        profile_image: { type: String, default: null },

        // specific appointment time if booked
        appointment_date: { type: Date, default: null },

        // inactive | waiting | scheduled | serving | completed | cancelled | no-show | booked | follow_up
        status: {
            type: String,
            enum: ['inactive', 'waiting', 'scheduled', 'serving', 'completed', 'cancelled', 'no-show', 'booked', 'follow_up'],
            default: 'inactive',
        },

        // Computed priority score — stored so the queue can be rebuilt quickly
        score: { type: Number, default: 0 },
    },
    { timestamps: true }
);

module.exports = mongoose.model('User', UserSchema);
