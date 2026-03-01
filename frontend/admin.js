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
    populateDoctorDropdown(); // fill doctor selector in Add Patient form
    refreshInterval = setInterval(refreshAll, 15000); // 15s refresh
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
        const res = await apiFetch('/service/stats');
        const data = await res.json();

        updateText(document.querySelector('#stat-patients .stat-value'), data.total_users);
        updateText(document.querySelector('#stat-staff .stat-value'), data.total_staff);
        updateText(document.querySelector('#stat-queue .stat-value'), data.queue_length);
        updateText(document.querySelector('#stat-wait .stat-value'), data.average_wait_minutes + 'm');
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
            setHtml(container, '<div class="empty-state">No patients in queue</div>');
            return;
        }

        setHtml(container, active.map((u, i) => `
            <div class="queue-card">
                <div class="queue-rank">#${i + 1}</div>
                <div class="queue-info">
                    <div class="queue-name">${escHtml(u.name)}</div>
                    <div class="queue-score">Score: ${u.score.toFixed(1)} · P${u.priority_level} · ${u.estimated_service_time}min</div>
                </div>
                <span class="badge badge-${u.visit_type || 'regular'}">${(u.visit_type || 'regular').replace('_', '-')}</span>
            </div>
        `).join(''));
    } catch (err) {
        console.error('Failed to load queue:', err);
    }
}

async function loadPatients() {
    try {
        const res = await apiFetch('/users');
        const data = await res.json();
        const container = document.getElementById('patient-list');

        const staffRes = await apiFetch('/staff');
        const staffData = await staffRes.json();
        const activeStaffList = staffData.staff.filter(s => s.active);

        setHtml(container, data.users.map(u => {
            const id = u._id;
            const isActive = ['waiting', 'scheduled', 'booked'].includes(u.status);
            const isBooked = u.status === 'booked';

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
                    ${isBooked && u.appointment_date ? `<span class="badge badge-info">${new Date(u.appointment_date).toLocaleDateString()}</span>` : ''}
                </div>
                
                ${isActive ? `
                <div style="margin-top:10px; display:flex; gap:8px; align-items:center;">
                    <select class="input" style="padding:4px; font-size:0.8rem; flex:1;" id="assign-staff-${id}">
                        <option value="">Select Doctor...</option>
                        ${activeStaffList.map(s => `<option value="${s._id}" ${u.assigned_staff_id === s._id ? 'selected' : ''}>${s.name}</option>`).join('')}
                    </select>
                    <button class="btn btn-sm btn-primary" onclick="assignDoctor('${id}')">Assign</button>
                </div>
                ` : ''}

                <div class="patient-actions" style="margin-top:10px;">
                    ${isActive && !u.assigned_staff_id ? `<button class="btn btn-sm btn-success" onclick="schedulePatient('${id}')">Auto-Assign</button>` : ''}
                    ${isActive && u.visit_type !== 'emergency' ? `<button class="btn btn-sm btn-danger" onclick="convertToEmergency('${id}')" title="Upgrade to Emergency" style="background:linear-gradient(135deg,#ef4444,#dc2626); color:white; font-weight:700;">🚨 Emergency</button>` : ''}
                    <button class="btn btn-sm" onclick="toggleEditPanel('${id}')" style="background:var(--bg-secondary); border:1px solid var(--border);">✏️ Edit</button>
                    ${isActive ? `<button class="btn btn-sm btn-warning" onclick="noShowPatient('${id}')">No-show</button>` : ''}
                    ${isActive ? `<button class="btn btn-sm btn-danger" onclick="cancelPatient('${id}')">Cancel</button>` : ''}
                    <button class="btn btn-sm btn-info" onclick="openUploadModal('${id}')">📎 Files</button>
                </div>

                <!-- Inline Edit Panel (hidden by default) -->
                <div id="edit-panel-${id}" style="display:none; margin-top:10px; padding:12px; background:var(--bg-secondary); border-radius:10px; border:1px solid var(--border);">
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px;">
                        <div>
                            <label style="font-size:0.72rem; font-weight:600; color:var(--text-secondary); display:block; margin-bottom:4px;">VISIT TYPE</label>
                            <select id="edit-type-${id}" style="width:100%; padding:6px; border:1px solid var(--border); border-radius:6px; font-size:0.85rem; font-family:inherit;">
                                <option value="regular" ${u.visit_type === 'regular' ? 'selected' : ''}>Regular</option>
                                <option value="emergency" ${u.visit_type === 'emergency' ? 'selected' : ''}>Emergency</option>
                                <option value="follow_up" ${u.visit_type === 'follow_up' ? 'selected' : ''}>Follow-Up</option>
                            </select>
                        </div>
                        <div>
                            <label style="font-size:0.72rem; font-weight:600; color:var(--text-secondary); display:block; margin-bottom:4px;">PRIORITY</label>
                            <select id="edit-priority-${id}" style="width:100%; padding:6px; border:1px solid var(--border); border-radius:6px; font-size:0.85rem; font-family:inherit;">
                                ${[1, 2, 3, 4, 5].map(p => `<option value="${p}" ${u.priority_level === p ? 'selected' : ''}>P${p}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div style="margin-bottom:8px;">
                        <label style="font-size:0.72rem; font-weight:600; color:var(--text-secondary); display:block; margin-bottom:4px;">ASSIGNED DOCTOR</label>
                        <select id="edit-doctor-${id}" style="width:100%; padding:6px; border:1px solid var(--border); border-radius:6px; font-size:0.85rem; font-family:inherit;">
                            <option value="">— Keep current / Auto-assign —</option>
                            ${activeStaffList.map(s => `<option value="${s._id}" ${u.assigned_staff_id === s._id ? 'selected' : ''}>${escHtml(s.name)}</option>`).join('')}
                        </select>
                    </div>
                    <button class="btn btn-sm btn-primary" onclick="savePatientEdit('${id}')" style="width:100%;">💾 Save Changes</button>
                </div>
            </div>`;
        }).join(''));

    } catch (err) {
        console.error('Failed to load patients:', err);
    }
}

async function updatePriority(userId, level) {
    try {
        const res = await apiFetch(`/users/priority/${userId}`, {
            method: 'PATCH',
            body: JSON.stringify({ priority_level: parseInt(level) })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        toast(`Priority updated to P${level}`, 'success');
        refreshAll();
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function populateDoctorDropdown() {
    try {
        const res = await apiFetch('/staff');
        const data = await res.json();
        const sel = document.getElementById('p-doctor');
        if (!sel) return;
        sel.innerHTML = '<option value="">— Auto-assign doctor —</option>';
        (data.staff || []).forEach(s => {
            sel.innerHTML += `<option value="${s._id}">${escHtml(s.name)}</option>`;
        });
    } catch (_) { }
}

async function addPatient(e) {
    e.preventDefault();
    const name = document.getElementById('p-name').value.trim();
    const visit_type = document.getElementById('p-visit-type').value;
    const priority_level = parseInt(document.getElementById('p-priority').value);
    const estimated_service_time = parseInt(document.getElementById('p-time').value);
    const preferredDoctorId = document.getElementById('p-doctor')?.value || null;

    try {
        // Single call — backend creates AND queues the patient atomically
        const res = await apiFetch('/users', {
            method: 'POST',
            body: JSON.stringify({ name, visit_type, priority_level, estimated_service_time, preferredDoctorId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        toast(`✅ Patient "${name}" added & queued (Position #${data.queue_position ?? '—'})`, 'success');
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
        const res = await apiFetch(`/service/cancel/${userId}`, { method: 'POST' });
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
        const res = await apiFetch(`/service/no-show/${userId}`, { method: 'POST' });
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
        const res = await apiFetch(`/service/emergency/${userId}`, { method: 'POST' });
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
                const qRes = await apiFetch(`/staff/queue/status/${staffId}`);
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
                    <button class="btn btn-sm btn-danger" onclick="deleteStaff('${staffId}')" style="padding: 2px 8px; font-size: 0.7rem;">Delete</button>
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

async function addStaffAccount(e) {
    e.preventDefault();
    const name = document.getElementById('s-name').value.trim();
    const email = document.getElementById('s-email').value.trim();
    const password = document.getElementById('s-password').value;
    const role = document.getElementById('s-role').value;
    const start_time = document.getElementById('s-start').value;
    const end_time = document.getElementById('s-end').value;

    try {
        const res = await apiFetch('/auth/create-user', {
            method: 'POST',
            body: JSON.stringify({ name, email, password, role, start_time, end_time }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        toast(data.message, 'success');
        document.getElementById('s-name').value = '';
        document.getElementById('s-email').value = '';
        document.getElementById('s-password').value = '';
        toggleForm('staff-form');
        refreshAll();
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function optimizeQueue() {
    try {
        const res = await apiFetch('/service/queue/optimize', { method: 'POST' });
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
async function assignDoctor(userId) {
    const staffId = document.getElementById(`assign-staff-${userId}`).value;
    if (!staffId) return toast('Select a doctor first', 'error');

    try {
        const res = await apiFetch(`/service/assign-doctor/${userId}/${staffId}`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        toast('Doctor assigned successfully', 'success');
        refreshAll();
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function deleteStaff(staffId) {
    if (!confirm('Are you sure you want to delete this staff member? Their active queue will be returned to the waiting pool.')) return;

    try {
        const res = await apiFetch(`/staff/${staffId}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        toast(data.message, 'success');
        refreshAll();
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function convertToEmergency(userId) {
    try {
        const res = await apiFetch(`/service/emergency/${userId}`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        toast('🚨 Patient upgraded to Emergency — moved to top of queue!', 'success');
        refreshAll();
    } catch (err) {
        toast(err.message, 'error');
    }
}

function toggleEditPanel(userId) {
    const panel = document.getElementById(`edit-panel-${userId}`);
    if (!panel) return;
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

async function savePatientEdit(userId) {
    const visit_type = document.getElementById(`edit-type-${userId}`)?.value;
    const priority_level = document.getElementById(`edit-priority-${userId}`)?.value;
    const staffId = document.getElementById(`edit-doctor-${userId}`)?.value || null;

    try {
        const res = await apiFetch(`/users/edit/${userId}`, {
            method: 'PATCH',
            body: JSON.stringify({ visit_type, priority_level, staffId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        toast('Patient updated ✓', 'success');
        toggleEditPanel(userId);
        refreshAll();
    } catch (err) {
        toast(err.message, 'error');
    }
}

window.convertToEmergency = convertToEmergency;
window.toggleEditPanel = toggleEditPanel;
window.savePatientEdit = savePatientEdit;
window.assignDoctor = assignDoctor;
window.deleteStaff = deleteStaff;
window.addStaffAccount = addStaffAccount;
window.populateDoctorDropdown = populateDoctorDropdown;
