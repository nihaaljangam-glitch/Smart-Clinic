/**
 * frontend/common.js — Shared Frontend Utilities (Auth-aware)
 */

/**
 * Fetch with Authorization header
 */
async function apiFetch(endpoint, options = {}) {
    const token = Auth.getToken();
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API}${endpoint}`, {
        ...options,
        headers,
    });

    if (res.status === 401) {
        Auth.logout();
        return;
    }

    return res;
}

/**
 * Smart innerHTML setter — skips the DOM write if content hasn't changed.
 * Prevents the full DOM tear-down/rebuild flicker on every poll cycle.
 */
function setHtml(element, html) {
    if (!element) return;
    if (element._lastHtml === html) return; // no change — do nothing
    element._lastHtml = html;
    element.innerHTML = html;
}

/**
 * Smart text setter — only updates the DOM node if the value changed.
 */
function updateText(element, text) {
    if (!element) return;
    const str = String(text ?? '');
    if (element.textContent !== str) element.textContent = str;
}

function toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

function escHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function toggleForm(formId) {
    const form = document.getElementById(formId);
    if (form) form.classList.toggle('show');
}
