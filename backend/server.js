/**
 * server.js — Smart Clinic Entry Point (MongoDB edition)
 *
 * Startup order:
 *   1. Load env vars
 *   2. Connect to MongoDB
 *   3. Rebuild the in-memory priority heap from the DB
 *   4. Optionally seed data if the DB is empty
 *   5. Start listening
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

// ─── Routers ──────────────────────────────────────────────────
const authRouter = require('./routers/auth');
const usersRouter = require('./routers/users');
const staffRouter = require('./routers/staff');
const serviceRouter = require('./routers/service');
const uploadsRouter = require('./routers/uploads');

// ─── Shared QueueService Instance ────────────────────────────
const queueService = require('./services/instance');

// ─── Mongoose Models (for seeding) ───────────────────────────
const { User, Staff, Auth } = require('./models');

// ─── App Setup ────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/smart-clinic';
const JWT_SECRET = process.env.JWT_SECRET || 'smart-clinic-super-secret-key';

// ─── Middleware ───────────────────────────────────────────────
const allowedOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'https://smart-clinic-bro0.onrender.com',
    /\.vercel\.app$/,   // any Vercel preview/prod deployment
];
app.use(cors({
    origin: (origin, cb) => {
        // Allow requests with no origin (curl, Postman, server-to-server)
        if (!origin) return cb(null, true);
        const ok = allowedOrigins.some(o =>
            typeof o === 'string' ? o === origin : o.test(origin)
        );
        cb(ok ? null : new Error('Not allowed by CORS'), ok);
    },
    credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json());


// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Serve frontend as static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ─── Mount API Routers ────────────────────────────────────────
app.use('/auth', authRouter);
app.use('/users', usersRouter);
app.use('/staff', staffRouter);
app.use('/service', serviceRouter);
app.use('/uploads', uploadsRouter);

// ─── Health Check ─────────────────────────────────────────────
app.get('/health', async (_req, res) => {
    try {
        const stats = await queueService.getStats();
        res.json({
            status: 'ok',
            db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
            uptime: Math.round(process.uptime()),
            ...stats,
        });
    } catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});

// ─── Seed Data (only if DB is empty) ─────────────────────────
async function seedIfEmpty() {
    const authCount = await Auth.countDocuments();

    if (authCount > 0) {
        console.log(`[Seed] DB already has data. Skipping seed.`);
        return;
    }

    console.log('\n[Seed] Empty DB detected — seeding example data with accounts...');

    // Sign up staff
    const admin = await queueService.register({ name: 'Clinic Admin', email: 'admin@clinic.com', password: 'password123', role: 'admin' });
    const s1 = await queueService.register({ name: 'Dr. Sharma', email: 'sharma@clinic.com', password: 'password123', role: 'staff' });
    const s2 = await queueService.register({ name: 'Dr. Patel', email: 'patel@clinic.com', password: 'password123', role: 'staff' });

    // Sign up patients
    const u1result = await queueService.register({ name: 'Rahul Kumar', email: 'rahul@gmail.com', password: 'password123', role: 'patient' });
    const u2result = await queueService.register({ name: 'Priya Singh', email: 'priya@gmail.com', password: 'password123', role: 'patient' });
    const u3result = await queueService.register({ name: 'Amit Verma', email: 'amit@gmail.com', password: 'password123', role: 'patient' });

    const u1 = u1result.auth.linked_id;
    const u2 = u2result.auth.linked_id;
    const u3 = u3result.auth.linked_id;

    // Additional patient setup
    const p2 = await User.findById(u2);
    p2.visit_type = 'emergency';
    p2.priority_level = 5;
    await p2.save();

    const p3 = await User.findById(u3);
    p3.visit_type = 'follow_up';
    p3.priority_level = 1;
    await p3.save();

    try {
        await queueService.scheduleUser(u1.toString());
        await queueService.scheduleUser(u2.toString());
        await queueService.scheduleUser(u3.toString());
    } catch (err) {
        console.warn('[Seed] Scheduling note:', err.message);
    }

    await queueService.optimizeQueue();

    console.log('[Seed] Done — Admin, 2 staff, and 3 patients registered and scheduled.\n');
}

// ─── Connect to MongoDB then Start Server ─────────────────────
async function start() {
    try {
        console.log(`\n📡 Connecting to MongoDB: ${MONGO_URI}`);
        await mongoose.connect(MONGO_URI);
        console.log('✅ MongoDB connected\n');

        // Rebuild the in-memory priority heap from existing DB records
        await queueService.init();

        // Seed only when the database is completely empty
        await seedIfEmpty();

        app.listen(PORT, () => {
            console.log(`\n🚀 Smart Clinic running at http://localhost:${PORT}`);
            console.log(`\n📋 API Endpoints:`);
            console.log(`   GET    /users                      — List all patients`);
            console.log(`   POST   /users                      — Add patient`);
            console.log(`   PATCH  /users/history              — Update medical history`);
            console.log(`   POST   /users/book                 — Book appointment`);
            console.log(`   GET    /users/status/:id           — Patient status`);
            console.log(`   PATCH  /users/profile              — Update profile`);
            console.log(`   GET    /users/files/:id            — List user files`);
            console.log(`   GET    /staff                      — List all staff`);
            console.log(`   POST   /staff                      — Add staff`);
            console.log(`   DELETE /staff/:id                  — Delete staff`);
            console.log(`   GET    /staff/queue/status/:id     — Staff queue`);
            console.log(`   POST   /service/schedule/:id       — Auto-schedule patient`);
            console.log(`   POST   /service/assign-doctor/:u/:s — Manual doctor assign`);
            console.log(`   POST   /service/queue/optimize     — Optimize/rebalance queues`);
            console.log(`   POST   /service/cancel/:id         — Cancel patient`);
            console.log(`   POST   /service/no-show/:id        — Mark no-show`);
            console.log(`   POST   /service/complete/:id       — Mark complete`);
            console.log(`   POST   /service/reassign/:id       — Reassign patient`);
            console.log(`   PATCH  /service/users/:id/status   — Generic status update`);
            console.log(`   POST   /service/emergency/:id      — Emergency override`);
            console.log(`   GET    /service/stats              — Dashboard stats`);
            console.log(`   POST   /upload/:id                 — Upload file`);
            console.log(`   GET    /files/:id                  — List patient files`);
            console.log(`   GET    /download/:id/:fileId       — Download file`);
            console.log(`   GET    /health                     — Health check\n`);
        });

    } catch (err) {
        console.error('❌ Failed to connect to MongoDB:', err.message);
        console.error('\n💡 Make sure MongoDB is running:');
        console.error('   macOS:  brew services start mongodb-community');
        console.error('   Linux:  sudo systemctl start mongod\n');
        process.exit(1);
    }
}

// Handle Mongoose disconnect gracefully
mongoose.connection.on('disconnected', () => {
    console.warn('[MongoDB] Disconnected');
});

process.on('SIGINT', async () => {
    await mongoose.disconnect();
    console.log('\n[MongoDB] Connection closed. Goodbye!');
    process.exit(0);
});

start();

module.exports = app;
