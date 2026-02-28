/**
 * /tmp/cleanup_data.js
 * Merges duplicate staff/user records in MongoDB.
 */

require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');
const { User, Staff, Auth } = require('../models');

async function cleanup() {
    const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/smart-clinic';
    console.log(`Connecting to ${MONGO_URI}...`);
    await mongoose.connect(MONGO_URI);

    console.log('Cleaning up duplicate Staff...');
    const allStaff = await Staff.find();
    const staffByName = {};

    for (const s of allStaff) {
        if (!staffByName[s.name]) staffByName[s.name] = [];
        staffByName[s.name].push(s);
    }

    for (const name in staffByName) {
        const duplicates = staffByName[name];
        if (duplicates.length > 1) {
            console.log(`Merging ${duplicates.length} records for ${name}`);
            // Pick the one that is linked to an Auth record if possible
            let primary = null;
            for (const d of duplicates) {
                const linkedAuth = await Auth.findOne({ linked_id: d._id });
                if (linkedAuth) {
                    primary = d;
                    break;
                }
            }
            if (!primary) primary = duplicates[0];

            for (const d of duplicates) {
                if (d._id.toString() === primary._id.toString()) continue;

                console.log(`  Merging duplicate ${d._id} into primary ${primary._id}`);

                // Move users assigned to this duplicate
                const patients = await User.find({ assigned_staff_id: d._id });
                for (const p of patients) {
                    p.assigned_staff_id = primary._id;
                    await p.save();

                    // Add to primary queue if not already there
                    if (!primary.queue.includes(p._id)) {
                        primary.queue.push(p._id);
                        primary.workload += p.estimated_service_time;
                    }
                }

                // Delete duplicate
                await Staff.findByIdAndDelete(d._id);
            }
            await primary.save();
        }
    }

    console.log('Ensuring all Auth records are linked correctly...');
    const allAuth = await Auth.find();
    for (const a of allAuth) {
        if (a.role === 'staff' || a.role === 'patient') {
            const Model = a.role === 'staff' ? Staff : User;
            const profile = await Model.findOne({ name: a.name });
            if (profile && (!a.linked_id || a.linked_id.toString() !== profile._id.toString())) {
                console.log(`  Updating Auth ${a.email} linked_id from ${a.linked_id} to ${profile._id}`);
                a.linked_id = profile._id;
                await a.save();
            }
        }
    }

    console.log('Cleanup complete.');
    await mongoose.disconnect();
}

cleanup().catch(err => {
    console.error(err);
    process.exit(1);
});
