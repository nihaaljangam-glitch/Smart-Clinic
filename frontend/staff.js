/**
 * frontend/staff.js — Doctor Dashboard Logic
 */

let refreshInterval;

document.addEventListener('DOMContentLoaded', () => {
    const user = Auth.getUser();
    if (user?.role !== 'staff') {
        Auth.redirectToDashboard(user?.role);
        return;
    }

    document.getElementById('doctor-name').textContent = user.name;
    refreshAll();
    refreshInterval = setInterval(refreshAll, 15000); // 15s refresh
});

async function refreshAll() {
    await Promise.all([
        loadMyQueue(),
        loadMyProfile(),
    ]);
}

async function loadMyProfile() {
    try {
        const user = Auth.getUser();
        const res = await apiFetch('/staff');
        const data = await res.json();
        const me = data.staff.find(s => s._id === user.linked_id);

        if (me) {
            document.getElementById('stat-workload').textContent = me.workload + 'm';
            document.getElementById('work-hours').textContent = `${me.start_time} to ${me.end_time}`;
        }
    } catch (err) {
        console.error('Failed to load profile:', err);
    }
}

async function loadMyQueue() {
    try {
        const user = Auth.getUser();
        const staffId = user.linked_id;

        const res = await apiFetch(`/staff/queue/status/${staffId}`);
        const data = await res.json();

        const container = document.getElementById('patient-queue-list');
        const servingContainer = document.getElementById('serving-container');

        const queue = data.queue_details || [];
        updateText(document.getElementById('stat-my-queue'), queue.length);

        if (queue.length === 0) {
            setHtml(container, '<div class="empty-state">No patients assigned to you.</div>');
            servingContainer.style.display = 'none';
            return;
        }

        // The first patient in the queue is either "serving" or "scheduled"
        const top = queue[0];

        if (top.status === 'serving' || top.status === 'scheduled') {
            servingContainer.style.display = 'block';
            const isServing = top.status === 'serving';

            setHtml(servingContainer, `
                <div class="patient-big-card" style="border-left-color: ${isServing ? 'var(--success)' : 'var(--accent)'}">
                    <div class="badge" style="margin-bottom: 10px; background: ${isServing ? 'rgba(34,197,94,0.2)' : 'rgba(56,189,248,0.2)'}">
                        ${isServing ? 'ONGOING SESSION' : 'READY TO START'}
                    </div>
                    <div class="serving-name">${escHtml(top.name)}</div>
                    <div class="serving-meta">
                        <span class="badge badge-${top.visit_type}">${top.visit_type}</span>
                        <span class="badge badge-priority">P${top.priority_level}</span>
                        <span class="badge badge-waiting">${top.estimated_service_time} min</span>
                    </div>
                    <div class="serving-actions">
                        <button class="btn btn-primary" onclick="updateUserStatus('${top._id}', 'completed')">Complete Session</button>
                        <button class="btn btn-warning" onclick="reassignPatient('${top._id}')">Reassign</button>
                        <button class="btn btn-info" onclick="openViewFilesModal('${top._id}', '${top.name}')">View Files</button>
                    </div>
                </div>
            `);
        }

        // List the rest
        const upcoming = queue.slice(top.status === 'serving' || top.status === 'scheduled' ? 1 : 0);

        if (upcoming.length === 0) {
            setHtml(container, '<div class="empty-state">No upcoming patients.</div>');
        } else {
            setHtml(container, upcoming.map(u => `
                <div class="patient-card" style="margin-bottom: 10px;">
                    <div class="patient-top">
                        <span class="patient-name">${escHtml(u.name)}</span>
                        <span class="badge badge-priority">P${u.priority_level}</span>
                    </div>
                    <div class="patient-meta">
                        <span class="badge badge-${u.visit_type}">${u.visit_type}</span>
                        <span class="badge badge-waiting">${u.estimated_service_time}min</span>
                    </div>
                    <div class="patient-actions">
                        <button class="btn btn-sm btn-primary" onclick="updateUserStatus('${u._id}', 'completed')">Complete</button>
                        <button class="btn btn-sm btn-warning" onclick="reassignPatient('${u._id}')">Reassign</button>
                        <button class="btn btn-sm btn-info" onclick="openViewFilesModal('${u._id}', '${escHtml(u.name)}')">View Files</button>
                    </div>
                </div>
            `).join(''));
        }
    } catch (err) {
        console.error('Failed to load queue:', err);
    }
}

async function updateUserStatus(userId, status) {
    try {
        let endpoint = `/users/status/${userId}`;
        let method = 'PATCH';
        let body = JSON.stringify({ status });

        // Special handling if using dedicated endpoints (though PATCH /status is generic)
        if (status === 'completed') {
            endpoint = `/service/complete/${userId}`;
            method = 'POST';
            body = null;
        }

        const res = await apiFetch(endpoint, {
            method,
            body
        });

        if (!res.ok) throw new Error('Failed to update status');
        toast(`Patient marked as ${status}`, 'success');
        refreshAll();
    } catch (err) {
        toast(err.message, 'error');
        console.error(err);
    }
}

async function reassignPatient(userId) {
    if (!confirm('Are you sure you want to reassign this patient back to the general pool?')) return;
    try {
        const res = await apiFetch(`/service/reassign/${userId}`, { method: 'POST' });
        if (!res.ok) throw new Error('Failed to reassign patient');
        toast('Patient reassigned to general pool', 'info');
        refreshAll();
    } catch (err) {
        toast(err.message, 'error');
    }
}

// ─── FILE VIEWING ─────────────────────────────────────────────

function openViewFilesModal(userId, name) {
    document.getElementById('modal-title').textContent = `Files for ${name}`;
    document.getElementById('upload-modal').classList.add('show');
    loadUserFiles(userId);
}

function closeUploadModal() {
    document.getElementById('upload-modal').classList.remove('show');
}

function closeModal(e) {
    if (e.target === e.currentTarget) closeUploadModal();
}

async function loadUserFiles(userId) {
    const container = document.getElementById('user-files-list');
    container.innerHTML = '<p style="padding:16px; color: var(--text-secondary);">Loading files...</p>';
    try {
        // Upload router serves files at /files/:userId
        const res = await apiFetch(`/files/${userId}`);
        const data = await res.json();
        if (!data.files || data.files.length === 0) {
            container.innerHTML = '<div style="padding:20px; text-align:center; color: var(--text-secondary);">📭 No documents uploaded by this patient.</div>';
            return;
        }
        const getIcon = (name) => {
            const ext = name.split('.').pop().toLowerCase();
            if (['jpg', 'jpeg', 'png', 'gif'].includes(ext)) return '🖼️';
            if (ext === 'pdf') return '📕';
            if (['doc', 'docx'].includes(ext)) return '📝';
            return '📄';
        };
        container.innerHTML = `
            <div style="padding: 8px 16px; font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); border-bottom: 1px solid var(--border); margin-bottom: 4px;">
                ${data.files.length} document(s) found
            </div>
            ${data.files.map(f => `
                <div class="file-item" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border);">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <span style="font-size:1.4rem;">${getIcon(f.filename)}</span>
                        <div>
                            <div style="font-weight:600; font-size:0.9rem;">${escHtml(f.filename)}</div>
                            <div style="font-size:0.75rem; color:var(--text-secondary);">${f.uploaded_at ? new Date(f.uploaded_at).toLocaleDateString() : ''}</div>
                        </div>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <a href="${API}/download/${userId}/${f.file_id}" target="_blank" class="btn btn-sm btn-info" style="text-decoration:none; font-size:0.8rem;">View</a>
                    </div>
                </div>
            `).join('')}
        `;
    } catch (err) {
        container.innerHTML = '<div style="padding:16px; color:var(--danger);">Failed to load patient files.</div>';
        console.error('loadUserFiles error:', err);
    }
}
