/**
 * frontend/admin.js — Admin Dashboard Logic
 */

let refreshInterval;

document.addEventListener('DOMContentLoaded', () => {
    if (Auth.getUser()?.role !== 'admin') {
        Auth.redirectToDashboard(Auth.getUser()?.role);
        return;
    }

    refreshAll();
    refreshInterval = setInterval(refreshAll, 5000);
    setupDropZone();
});

async function refreshAll() {
    await Promise.all([
        loadStats(),
        loadQueue(),
        loadPatients(),
        loadStaff(),
    ]);
}

async function loadStats() {
    try {
        const res = await apiFetch('/stats');
        const data = await res.json();

        document.querySelector('#stat-patients .stat-value').textContent = data.total_users;
        document.querySelector('#stat-staff .stat-value').textContent = data.total_staff;
        document.querySelector('#stat-queue .stat-value').textContent = data.queue_length;
        document.querySelector('#stat-wait .stat-value').textContent = data.average_wait_minutes + 'm';
    } catch (err) {
        console.error('Failed to load stats:', err);
    }
}

async function loadQueue() {
    try {
        const res = await apiFetch('/users');
        const data = await res.json();
        const container = document.getElementById('queue-list');

        const active = data.users
            .filter(u => ['waiting', 'scheduled'].includes(u.status))
            .sort((a, b) => b.score - a.score);

        if (active.length === 0) {
            container.innerHTML = '<div class="empty-state">No patients in queue</div>';
            return;
        }

        container.innerHTML = active.map((u, i) => `
            <div class="queue-card">
                <div class="queue-rank">#${i + 1}</div>
                <div class="queue-info">
                    <div class="queue-name">${escHtml(u.name)}</div>
                    <div class="queue-score">Score: ${u.score.toFixed(1)} · P${u.priority_level} · ${u.estimated_service_time}min</div>
                </div>
                <span class="badge badge-${u.visit_type || 'regular'}">${(u.visit_type || 'regular').replace('_', '-')}</span>
            </div>
        `).join('');
    } catch (err) {
        console.error('Failed to load queue:', err);
    }
}

async function loadPatients() {
    try {
        const res = await apiFetch('/users');
        const data = await res.json();
        const container = document.getElementById('patient-list');

        if (data.users.length === 0) {
            container.innerHTML = '<div class="empty-state">No patients yet</div>';
            return;
        }

        container.innerHTML = data.users.map(u => {
            const id = u._id;
            const isActive = ['waiting', 'scheduled'].includes(u.status);
            return `
            <div class="patient-card">
                <div class="patient-top">
                    <span class="patient-name">${escHtml(u.name)}</span>
                    <span class="badge badge-${u.status}">${u.status}</span>
                </div>
                <div class="patient-meta">
                    <span class="badge badge-${u.visit_type || 'regular'}">${(u.visit_type || 'regular').replace('_', '-')}</span>
                    <span class="badge badge-priority">P${u.priority_level}</span>
                    <span class="badge badge-waiting">${u.estimated_service_time}min</span>
                    ${u.assigned_staff_id ? `<span class="badge badge-scheduled">Assigned</span>` : ''}
                </div>
                <div class="patient-actions">
                    ${isActive && !u.assigned_staff_id ? `<button class="btn btn-sm btn-success" onclick="schedulePatient('${id}')">Schedule</button>` : ''}
                    ${isActive ? `<button class="btn btn-sm btn-danger" onclick="cancelPatient('${id}')">Cancel</button>` : ''}
                    ${isActive ? `<button class="btn btn-sm btn-warning" onclick="noShowPatient('${id}')" title="Mark as No-Show">No-Show</button>` : ''}
                    ${isActive ? `<button class="btn btn-sm btn-danger" onclick="emergencyOverride('${id}')" style="background:#b91c1c">🚨 Emergency</button>` : ''}
                    <button class="btn btn-sm btn-info" onclick="openUploadModal('${id}')">📎 Files</button>
                </div>
            </div>`;
        }).join('');
    } catch (err) {
        console.error('Failed to load patients:', err);
    }
}

async function addPatient(e) {
    e.preventDefault();
    const name = document.getElementById('p-name').value.trim();
    const visit_type = document.getElementById('p-visit-type').value;
    const priority_level = parseInt(document.getElementById('p-priority').value);
    const estimated_service_time = parseInt(document.getElementById('p-time').value);

    try {
        const res = await apiFetch('/users', {
            method: 'POST',
            body: JSON.stringify({ name, visit_type, priority_level, estimated_service_time }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        toast(`Patient "${name}" added`, 'success');
        document.getElementById('p-name').value = '';
        toggleForm('patient-form');
        refreshAll();
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function schedulePatient(userId) {
    try {
        const res = await apiFetch(`/service/schedule/${userId}`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        toast(data.message, 'success');
        refreshAll();
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function cancelPatient(userId) {
    try {
        const res = await apiFetch(`/cancel/${userId}`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        toast('Patient cancelled', 'info');
        refreshAll();
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function noShowPatient(userId) {
    try {
        const res = await apiFetch(`/no-show/${userId}`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        toast('Patient marked as no-show', 'info');
        refreshAll();
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function emergencyOverride(userId) {
    try {
        const res = await apiFetch(`/emergency/${userId}`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        toast(data.message, 'error');
        refreshAll();
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function loadStaff() {
    try {
        const res = await apiFetch('/staff');
        const data = await res.json();
        const container = document.getElementById('staff-list');

        if (data.staff.length === 0) {
            container.innerHTML = '<div class="empty-state">No staff yet</div>';
            return;
        }

        const staffHtml = await Promise.all(data.staff.map(async (s) => {
            const staffId = s._id;
            let queueDetails = [];
            try {
                const qRes = await apiFetch(`/queue/status/${staffId}`);
                const qData = await qRes.json();
                queueDetails = qData.queue_details || [];
            } catch (_) { }

            const workloadPct = Math.min(100, (s.workload / 120) * 100);
            return `
            <div class="staff-card">
                <div class="staff-name">${escHtml(s.name)}</div>
                <div class="staff-meta">
                    <span class="badge badge-scheduled">${s.start_time} – ${s.end_time}</span>
                    <span class="badge badge-priority">${s.workload} min load</span>
                    <span class="badge ${s.active ? 'badge-scheduled' : 'badge-cancelled'}">${s.active ? 'Active' : 'Inactive'}</span>
                </div>
                <div class="workload-bar-outer">
                    <div class="workload-bar-inner" style="width: ${workloadPct}%"></div>
                </div>
                ${queueDetails.length > 0 ? `
                <div class="staff-queue-list">
                    ${queueDetails.map(q => `<div class="staff-queue-item">• ${escHtml(q.name)} (P${q.priority_level})</div>`).join('')}
                </div>` : '<div class="staff-queue-item" style="margin-top:6px;font-size:0.75rem;color:var(--text-muted);">No patients assigned</div>'}
            </div>`;
        }));

        container.innerHTML = staffHtml.join('');
    } catch (err) {
        console.error('Failed to load staff:', err);
    }
}

async function addStaff(e) {
    e.preventDefault();
    const name = document.getElementById('s-name').value.trim();
    const start_time = document.getElementById('s-start').value;
    const end_time = document.getElementById('s-end').value;

    try {
        const res = await apiFetch('/staff', {
            method: 'POST',
            body: JSON.stringify({ name, start_time, end_time }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        toast(`Staff "${name}" added`, 'success');
        document.getElementById('s-name').value = '';
        toggleForm('staff-form');
        refreshAll();
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function optimizeQueue() {
    try {
        const res = await apiFetch('/queue/optimize', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        toast(`Queue optimized — ${data.queue_length} entries rebalanced`, 'success');
        refreshAll();
    } catch (err) {
        toast(err.message, 'error');
    }
}

// ─── FILE UPLOAD (Admin can manage all) ───────────────────────

function openUploadModal(userId) {
    document.getElementById('upload-user-id').value = userId;
    document.getElementById('upload-modal').classList.add('show');
    document.getElementById('file-name-display').textContent = '';
    document.getElementById('btn-upload').disabled = true;
    document.getElementById('file-input').value = '';
    loadUserFiles(userId);
}

function closeUploadModal() {
    document.getElementById('upload-modal').classList.remove('show');
}

function closeModal(e) {
    if (e.target === e.currentTarget) closeUploadModal();
}

function setupDropZone() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    if (!dropZone) return;

    dropZone.onclick = () => fileInput.click();
    dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); };
    dropZone.ondragleave = () => dropZone.classList.remove('drag-over');
    dropZone.ondrop = (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length) {
            fileInput.files = e.dataTransfer.files;
            onFileSelected();
        }
    };
    fileInput.onchange = onFileSelected;
}

function onFileSelected() {
    const fileInput = document.getElementById('file-input');
    if (fileInput.files.length) {
        document.getElementById('file-name-display').textContent = `📄 ${fileInput.files[0].name}`;
        document.getElementById('btn-upload').disabled = false;
    }
}

async function uploadFile(e) {
    e.preventDefault();
    const userId = document.getElementById('upload-user-id').value;
    const fileInput = document.getElementById('file-input');
    if (!fileInput.files.length) return;

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    try {
        // Raw fetch as FormData shouldn't have JSON content-type
        const res = await fetch(`${API}/upload/${userId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${Auth.getToken()}` },
            body: formData,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        toast(`File uploaded`, 'success');
        fileInput.value = '';
        document.getElementById('file-name-display').textContent = '';
        loadUserFiles(userId);
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function loadUserFiles(userId) {
    const container = document.getElementById('user-files-list');
    try {
        const res = await apiFetch(`/files/${userId}`);
        const data = await res.json();
        if (!data.files || data.files.length === 0) {
            container.innerHTML = '<h4>No files uploaded yet</h4>';
            return;
        }
        container.innerHTML = `
            <h4>Uploaded Files (${data.files.length})</h4>
            ${data.files.map(f => `
                <div class="file-item">
                    <span>📄 ${escHtml(f.filename)}</span>
                    <a href="${API}/download/${userId}/${f.file_id}" target="_blank">Download</a>
                </div>
            `).join('')}
        `;
    } catch (err) {
        container.innerHTML = '<h4>Failed to load files</h4>';
    }
}
