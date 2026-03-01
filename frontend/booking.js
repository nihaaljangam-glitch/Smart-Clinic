/**
 * frontend/booking.js — Booking Page Logic
 * Handles: visit type, preferred doctor + EDIT option, date, booking API, success screen.
 */

let selectedVisitType = 'regular';

document.addEventListener('DOMContentLoaded', async () => {
    const user = Auth.getUser();
    if (!user || user.role !== 'patient') {
        window.location.href = 'login.html';
        return;
    }

    document.getElementById('patient-greet').textContent = `Hi, ${user.name}`;

    // Block if already in queue
    const res = await apiFetch(`/users/status/${user.linked_id}`);
    const data = await res.json();
    if (['waiting', 'scheduled', 'serving'].includes(data.status)) {
        showAlreadyInQueue(data);
        return;
    }

    // Set minimum datetime to now
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('appointment-date').min = now.toISOString().slice(0, 16);
    document.getElementById('appointment-date').value = now.toISOString().slice(0, 16);

    await loadDoctors();
});

async function loadDoctors() {
    try {
        const res = await apiFetch('/staff');
        const data = await res.json();
        const select = document.getElementById('preferred-doctor');
        select.innerHTML = '<option value="">— Auto-assign best available —</option>';
        (data.staff || []).forEach(s => {
            const opt = document.createElement('option');
            opt.value = s._id;
            opt.textContent = `Dr. ${s.name.replace(/^Dr\.?\s*/i, '')}`;
            select.appendChild(opt);
        });
    } catch (err) {
        console.error('Failed to load doctors:', err);
    }
}

function selectVisitType(type) {
    selectedVisitType = type;
    document.querySelectorAll('.visit-type-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.type === type);
    });

    const notice = document.getElementById('emergency-notice');
    const dateGroup = document.getElementById('date-group');
    const btn = document.getElementById('btn-book');

    if (type === 'emergency') {
        notice.classList.add('show');
        btn.classList.add('emergency-mode');
        btn.textContent = '🚨 Emergency — Enter Queue Immediately';
        dateGroup.style.opacity = '0.4';
    } else {
        notice.classList.remove('show');
        btn.classList.remove('emergency-mode');
        btn.textContent = '🗓️ Confirm Booking & Enter Queue';
        dateGroup.style.opacity = '1';
    }
}

// ─── DOCTOR SELECTOR ──────────────────────────────────────────

function toggleDoctorEdit() {
    const row = document.getElementById('preferred-doctor-row');
    const btn = document.getElementById('btn-edit-doctor');
    const isHidden = row.style.display === 'none';
    row.style.display = isHidden ? 'block' : 'none';
    btn.textContent = isHidden ? '✕ Cancel' : '✏️ Change Doctor';
}

// ─── ALREADY IN QUEUE ─────────────────────────────────────────

function showAlreadyInQueue(data) {
    document.getElementById('booking-form-state').style.display = 'none';
    const s = document.getElementById('success-state');
    s.style.display = 'block';
    document.getElementById('success-icon').textContent = '📋';
    document.getElementById('success-title').textContent = 'You\'re Already in the Queue!';
    document.getElementById('success-msg').textContent = 'You have an active appointment. Go back to your dashboard.';
    document.getElementById('q-pos').textContent = data.queue_position ? `#${data.queue_position}` : '—';
    document.getElementById('q-wait').textContent = data.estimated_wait_minutes >= 0 ? `${data.estimated_wait_minutes}m` : '—';
}

// ─── SUBMIT BOOKING ───────────────────────────────────────────

async function submitBooking() {
    const date = document.getElementById('appointment-date').value;
    const preferredDoctorId = document.getElementById('preferred-doctor').value || null;

    if (!date && selectedVisitType !== 'emergency') {
        toast('Please select a preferred date and time', 'error');
        return;
    }

    const btn = document.getElementById('btn-book');
    btn.disabled = true;
    btn.textContent = 'Booking...';

    try {
        const bookingDate = date || new Date().toISOString();
        const res = await apiFetch('/users/book', {
            method: 'POST',
            body: JSON.stringify({ date: bookingDate, visitType: selectedVisitType, preferredDoctorId })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Booking failed');
        showSuccess(data, preferredDoctorId);
    } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
        btn.textContent = selectedVisitType === 'emergency' ? '🚨 Emergency — Enter Queue Immediately' : '🗓️ Confirm Booking & Enter Queue';
    }
}

function showSuccess(data, preferredDoctorId) {
    document.getElementById('booking-form-state').style.display = 'none';
    const s = document.getElementById('success-state');
    s.style.display = 'block';

    const isEmergency = selectedVisitType === 'emergency';
    const isAssigned = data.user && data.user.assigned_staff_id;

    if (isEmergency) {
        document.getElementById('success-icon').textContent = '🚨';
        document.getElementById('success-title').textContent = 'Emergency Registered!';
        document.getElementById('success-msg').textContent = 'You have been immediately assigned to an available doctor.';
        document.getElementById('position-stat').classList.add('emergency');
    } else {
        document.getElementById('success-msg').textContent = preferredDoctorId
            ? 'Booked with your preferred doctor.'
            : 'You are in the queue. A doctor will be assigned shortly.';
    }

    const pos = data.queue_position;
    const wait = data.estimated_wait_minutes;
    document.getElementById('q-pos').textContent = pos != null ? `#${pos}` : '—';
    document.getElementById('q-wait').textContent = wait != null ? `${wait}m` : '—';

    if (isAssigned) {
        const msg = document.getElementById('doctor-assigned-msg');
        msg.style.display = 'block';
        msg.textContent = preferredDoctorId ? '✅ Assigned to your preferred doctor.' : '✅ Auto-assigned to best available doctor.';
    }

    setTimeout(() => { window.location.href = 'dashboard-patient.html'; }, 5000);
}

window.selectVisitType = selectVisitType;
window.submitBooking = submitBooking;
window.toggleDoctorEdit = toggleDoctorEdit;
