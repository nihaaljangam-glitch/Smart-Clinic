/**
 * frontend/profile.js — Patient Profile Page Logic
 * Handles: profile photo, description, medical history, document uploads.
 */

let profileLoaded = false;

document.addEventListener('DOMContentLoaded', async () => {
    const user = Auth.getUser();
    if (!user || user.role !== 'patient') {
        window.location.href = 'login.html';
        return;
    }

    document.getElementById('profile-name').textContent = user.name;
    document.getElementById('profile-id-val').textContent = user.linked_id.slice(-8).toUpperCase();

    setupDropZone();
    await loadProfile();
    await loadMyFiles();
});

// ─── LOAD PROFILE ─────────────────────────────────────────────

async function loadProfile() {
    try {
        const user = Auth.getUser();
        const res = await apiFetch(`/users/status/${user.linked_id}`);
        const data = await res.json();

        // Load description only once (so user edits aren't overwritten)
        if (!profileLoaded) {
            if (data.description) {
                document.getElementById('profile-desc').value = data.description;
            }
            if (data.medical_history) {
                document.getElementById('history-text').value = data.medical_history;
            }
            profileLoaded = true;
        }

        // Always update the avatar preview
        if (data.profile_image) {
            document.getElementById('profile-img-preview').innerHTML =
                `<img src="${API}/download/${user.linked_id}/${data.profile_image}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
        }
    } catch (err) {
        console.error('Failed to load profile:', err);
    }
}

// ─── AVATAR PREVIEW ───────────────────────────────────────────

function previewImage(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('profile-img-preview').innerHTML =
                `<img src="${e.target.result}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
        };
        reader.readAsDataURL(input.files[0]);
    }
}

// ─── SAVE PROFILE ─────────────────────────────────────────────

async function saveProfile() {
    const user = Auth.getUser();
    const description = document.getElementById('profile-desc').value;
    const fileInput = document.getElementById('profile-image-input');
    const btn = document.getElementById('btn-save-profile');

    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        let profile_image = null;

        // Upload profile image if selected
        if (fileInput.files.length > 0) {
            const formData = new FormData();
            formData.append('file', fileInput.files[0]);
            const uploadRes = await fetch(`${API}/upload/${user.linked_id}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${Auth.getToken()}` },
                body: formData,
            });
            const uploadData = await uploadRes.json();
            if (!uploadRes.ok) throw new Error(uploadData.error || 'Image upload failed');
            profile_image = uploadData.file._id;
            fileInput.value = '';
        }

        const res = await apiFetch('/users/profile', {
            method: 'PATCH',
            body: JSON.stringify({ description, profile_image }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Profile update failed');

        toast('Profile saved ✓', 'success');
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Profile';
    }
}

// ─── SAVE HISTORY ─────────────────────────────────────────────

async function saveHistory() {
    const history = document.getElementById('history-text').value;
    const btn = document.getElementById('btn-save-history');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        const res = await apiFetch('/users/history', {
            method: 'PATCH',
            body: JSON.stringify({ history }),
        });
        if (!res.ok) throw new Error('Failed to save history');
        toast('Medical history saved ✓', 'success');
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Medical History';
    }
}

// ─── FILE UPLOAD ──────────────────────────────────────────────

function setupDropZone() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    if (!dropZone) return;

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
        document.getElementById('file-name-display').textContent = `📄 ${fileInput.files[0].name} selected`;
        document.getElementById('btn-upload').disabled = false;
    }
}

async function uploadFile(e) {
    e.preventDefault();
    const user = Auth.getUser();
    const fileInput = document.getElementById('file-input');
    if (!fileInput.files.length) return;

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    const btn = document.getElementById('btn-upload');
    btn.disabled = true;
    btn.textContent = 'Uploading...';

    try {
        const res = await fetch(`${API}/upload/${user.linked_id}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${Auth.getToken()}` },
            body: formData,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        toast('File uploaded ✓', 'success');
        fileInput.value = '';
        document.getElementById('file-name-display').textContent = '';
        btn.textContent = 'Upload File';
        loadMyFiles();
    } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Upload File';
    }
}

async function loadMyFiles() {
    const user = Auth.getUser();
    const container = document.getElementById('user-files-list');
    try {
        const res = await apiFetch(`/users/files/${user.linked_id}`);
        const data = await res.json();
        if (!data.files || data.files.length === 0) {
            container.innerHTML = '<p style="color:var(--text-secondary); font-size:0.85rem;">No documents uploaded yet.</p>';
            return;
        }
        const getIcon = (name) => {
            const ext = (name || '').split('.').pop().toLowerCase();
            if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return '🖼️';
            if (ext === 'pdf') return '📕';
            if (['doc', 'docx'].includes(ext)) return '📝';
            return '📄';
        };
        container.innerHTML = data.files.map(f => `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--border);">
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:1.3rem;">${getIcon(f.filename)}</span>
                    <div>
                        <div style="font-weight:600; font-size:0.9rem;">${escHtml(f.filename)}</div>
                        <div style="font-size:0.74rem; color:var(--text-secondary);">${f.uploaded_at ? new Date(f.uploaded_at).toLocaleDateString() : ''}</div>
                    </div>
                </div>
                <a href="${API}/download/${user.linked_id}/${f.file_id}" target="_blank" class="btn btn-sm btn-info" style="text-decoration:none; font-size:0.8rem;">View</a>
            </div>
        `).join('');
    } catch (err) {
        container.innerHTML = '<p style="color:var(--danger);">Failed to load files.</p>';
    }
}

// Expose globals
window.saveProfile = saveProfile;
window.saveHistory = saveHistory;
window.uploadFile = uploadFile;
window.previewImage = previewImage;
