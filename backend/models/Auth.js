/**
 * models/Auth.js — Mongoose Schema for User Authentication
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const AuthSchema = new mongoose.Schema(
    {
        email: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true
        },
        password: {
            type: String,
            required: true
        },
        name: {
            type: String,
            required: true,
            trim: true
        },
        role: {
            type: String,
            enum: ['patient', 'staff', 'admin'],
            required: true
        },
        // Reference to the linked Patient (User) or Staff document
        linked_id: {
            type: mongoose.Schema.Types.ObjectId,
            refPath: 'role_model',
            default: null
        },
        role_model: {
            type: String,
            enum: ['User', 'Staff'],
            required: function () { return this.role !== 'admin'; }
        }
    },
    { timestamps: true }
);

// Hash password before saving
AuthSchema.pre('save', async function () {
    if (!this.isModified('password')) return;
    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
    } catch (err) {
        throw err;
    }
});

// Method to check password
AuthSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('Auth', AuthSchema);
