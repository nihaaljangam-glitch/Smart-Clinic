/**
 * frontend/patient.js — Patient Dashboard (Status Hub)
 * Only handles queue status display.
 * Profile/history/files → profile.html
 * Booking → booking.html
 */

let refreshInterval;

document.addEventListener('DOMContentLoaded', () => {
    const user = Auth.getUser();
    if (!user || user.role !== 'patient') {
        Auth.redirectToDashboard(user?.role);
        return;
    }

    document.getElementById('patient-name').textContent = `Hi, ${user.name}`;
    document.getElementById('patient-id-val').textContent = user.linked_id.slice(-8).toUpperCase();

    loadMyStatus();
    refreshInterval = setInterval(loadMyStatus, 15000); // 15s — only status, very light
});

async function loadMyStatus() {
    try {
        const user = Auth.getUser();
        const res = await apiFetch(`/users/status/${user.linked_id}`);
        const data = await res.json();

        const status = data.status || 'inactive';
        const pos = data.queue_position;
        const wait = data.estimated_wait_minutes;

        // ── Hero ──────────────────────────────
        const heroPos = document.getElementById('hero-pos');
        const heroWait = document.getElementById('hero-wait');
        const statPos = document.getElementById('stat-pos');
        const statWait = document.getElementById('stat-wait');

        if (status === 'inactive') {
            heroPos.textContent = '—';
            heroWait.textContent = 'You have no active appointment. Book one below!';
            statPos.textContent = '—';
            statWait.textContent = '—';
        } else if (status === 'waiting') {
            heroPos.textContent = pos ? `#${pos}` : '?';
            heroWait.textContent = wait > 0 ? `Estimated wait: ~${wait} min` : 'Almost your turn!';
            statPos.textContent = pos ? `#${pos}` : '?';
            statWait.textContent = wait >= 0 ? `${wait}m` : '—';
        } else if (status === 'scheduled') {
            heroPos.textContent = pos ? `#${pos}` : '📋';
            heroWait.textContent = wait > 0 ? `Estimated wait: ~${wait} min` : 'Almost your turn!';
            statPos.textContent = pos ? `#${pos}` : 'Q';
            statWait.textContent = wait >= 0 ? `${wait}m` : '—';
        } else if (status === 'serving') {
            heroPos.textContent = '🩺';
            heroWait.textContent = 'You are currently being seen by a doctor.';
            statPos.textContent = 'NOW';
            statWait.textContent = '0m';
        } else if (status === 'completed') {
            heroPos.textContent = '✅';
            heroWait.textContent = 'Your session is complete. Thank you for visiting!';
            statPos.textContent = 'DONE';
            statWait.textContent = '—';
        } else if (status === 'booked') {
            heroPos.textContent = '📅';
            const apptDate = data.appointment_date ? new Date(data.appointment_date).toLocaleString() : '—';
            heroWait.textContent = `Upcoming appointment: ${apptDate}`;
            statPos.textContent = 'BOOKED';
            statWait.textContent = '—';
        } else {
            heroPos.textContent = status.toUpperCase();
            heroWait.textContent = '';
            statPos.textContent = '—';
            statWait.textContent = '—';
        }

        // ── Assigned Doctor ───────────────────
        const docRow = document.getElementById('assigned-doctor');
        const docNameVal = document.getElementById('doctor-name-val');
        const apptDocRow = document.getElementById('appt-doc-row');
        const detailDoctor = document.getElementById('detail-doctor');

        if (data.assigned_staff_id) {
            try {
                const sRes = await apiFetch('/staff');
                const sData = await sRes.json();
                const doctor = (sData.staff || []).find(s => s._id === data.assigned_staff_id);
                if (doctor) {
                    docNameVal.textContent = doctor.name;
                    docRow.style.display = 'block';
                    detailDoctor.textContent = doctor.name;
                    apptDocRow.style.display = 'flex';
                }
            } catch (_) { }
        } else {
            docRow.style.display = 'none';
            apptDocRow.style.display = 'none';
        }

        // ── Appointment Details ───────────────
        document.getElementById('detail-type').textContent = (data.visit_type || 'regular').toUpperCase();
        document.getElementById('detail-priority').textContent = data.priority_level ? `P${data.priority_level}` : '—';

        const statusBadgeMap = {
            inactive: 'sb-inactive', waiting: 'sb-waiting', scheduled: 'sb-scheduled',
            serving: 'sb-serving', completed: 'sb-completed'
        };
        const badge = statusBadgeMap[status] || 'sb-inactive';
        document.getElementById('detail-status').innerHTML =
            `<span class="status-badge ${badge}">${status.replace('_', ' ').toUpperCase()}</span>`;

        // ── Booking Card visibility ───────────
        const bookCard = document.getElementById('card-booking');
        if (['waiting', 'scheduled', 'serving'].includes(status)) {
            bookCard.style.opacity = '0.5';
            bookCard.style.pointerEvents = 'none';
            bookCard.querySelector('.nc-desc').textContent = 'Already in queue';
        } else {
            bookCard.style.opacity = '1';
            bookCard.style.pointerEvents = 'auto';
            bookCard.querySelector('.nc-desc').textContent = 'Join the queue & choose your doctor';
        }

    } catch (err) {
        console.error('Status load failed:', err);
    }
}
