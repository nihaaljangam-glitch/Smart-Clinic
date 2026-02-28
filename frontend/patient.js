/**
 * frontend/patient.js — Patient Dashboard Logic
 */

let refreshInterval;

document.addEventListener('DOMContentLoaded', () => {
    const user = Auth.getUser();
    if (user?.role !== 'patient') {
        Auth.redirectToDashboard(user?.role);
        return;
    }

    document.getElementById('patient-name').textContent = `Hello, ${user.name}`;
    refreshAll();
    refreshInterval = setInterval(refreshAll, 5000);
    setupDropZone();
});

async function refreshAll() {
    await Promise.all([
        loadMyStatus(),
        loadMyFiles(),
    ]);
}

async function loadMyStatus() {
    try {
        const user = Auth.getUser();
        const userId = user.linked_id;

        const res = await apiFetch(`/user/status/${userId}`);
        const data = await res.json();

        // Backend returns: { ...user, queue_position: X, estimated_wait_minutes: Y }
        const pos = data.queue_position || '?';
        const wait = data.estimated_wait_minutes || 0;

        document.getElementById('stat-pos').textContent = `#${pos}`;
        document.getElementById('hero-pos').textContent = pos;
        document.getElementById('stat-wait').textContent = wait + 'm';
        document.getElementById('hero-wait').textContent = `Estimated wait time: ${wait} minutes`;

        const details = data;
        document.getElementById('detail-type').textContent = (details.visit_type || 'regular').toUpperCase();
        document.getElementById('detail-priority').textContent = `P${details.priority_level || 1}`;

        const docNameVal = document.getElementById('doctor-name-val');
        const docRow = document.getElementById('assigned-doctor');

        if (details.assigned_staff_id) {
            // Fetch doctor name
            const sRes = await apiFetch('/staff');
            const sData = await sRes.json();
            const doctor = sData.staff.find(s => s._id === details.assigned_staff_id);
            if (doctor) {
                const isServing = details.status === 'serving';
                docNameVal.textContent = isServing ? `${doctor.name} (Currently Serving You)` : doctor.name;
                docRow.style.display = 'block';
                docRow.style.color = isServing ? 'var(--success)' : 'var(--accent)';

                if (isServing) {
                    document.getElementById('hero-wait').textContent = "You are currently in a session.";
                    document.getElementById('stat-wait').textContent = "0m";
                }
            }
        } else {
            docRow.style.display = 'none';
        }

    } catch (err) {
        console.error('Failed to load status:', err);
    }
}

// ─── FILE UPLOAD ──────────────────────────────────────────────

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
    const user = Auth.getUser();
    const userId = user.linked_id;
    const fileInput = document.getElementById('file-input');
    if (!fileInput.files.length) return;

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    try {
        const res = await fetch(`${API}/upload/${userId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${Auth.getToken()}` },
            body: formData,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        toast(`File uploaded successfully`, 'success');
        fileInput.value = '';
        document.getElementById('file-name-display').textContent = '';
        document.getElementById('btn-upload').disabled = true;
        loadMyFiles();
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function loadMyFiles() {
    const user = Auth.getUser();
    const userId = user.linked_id;
    const container = document.getElementById('user-files-list');

    try {
        const res = await apiFetch(`/files/${userId}`);
        const data = await res.json();
        if (!data.files || data.files.length === 0) {
            container.innerHTML = '<p style="font-size:0.8rem; color:var(--text-muted);">No documents uploaded yet.</p>';
            return;
        }
        container.innerHTML = `
            ${data.files.map(f => `
                <div class="file-item">
                    <span>📄 ${escHtml(f.filename)}</span>
                    <a href="${API}/download/${userId}/${f.file_id}" target="_blank">View</a>
                </div>
            `).join('')}
        `;
    } catch (err) {
        container.innerHTML = '<p>Failed to load files.</p>';
    }
}
