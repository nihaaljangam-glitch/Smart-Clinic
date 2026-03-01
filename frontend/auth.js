/**
 * frontend/auth.js — Shared Auth Utilities
 */

window.API = 'https://smart-clinic-bro0.onrender.com';


const Auth = {
    saveSession(token, user) {
        localStorage.setItem('sc_token', token);
        localStorage.setItem('sc_user', JSON.stringify(user));
    },

    getToken() {
        return localStorage.getItem('sc_token');
    },

    getUser() {
        const user = localStorage.getItem('sc_user');
        return user ? JSON.parse(user) : null;
    },

    isLoggedIn() {
        return !!this.getToken();
    },

    logout() {
        localStorage.removeItem('sc_token');
        localStorage.removeItem('sc_user');
        window.location.href = 'login.html';
    },

    async checkAuthAndRedirect() {
        if (!this.isLoggedIn()) {
            if (!window.location.pathname.endsWith('login.html') && !window.location.pathname.endsWith('signup.html')) {
                window.location.href = 'login.html';
            }
            return;
        }

        const user = this.getUser();
        const path = window.location.pathname;

        // Redirect from login/signup to dashboard if already logged in
        if (path.endsWith('login.html') || path.endsWith('signup.html') || path.endsWith('index.html') || path.endsWith('/')) {
            this.redirectToDashboard(user.role);
        }
    },

    redirectToDashboard(role) {
        if (role === 'admin') window.location.href = 'dashboard-admin.html';
        else if (role === 'staff') window.location.href = 'dashboard-staff.html';
        else if (role === 'patient') window.location.href = 'dashboard-patient.html';
    }
};

// Auto-check on load (except for login/signup pages where we might want to stay)
if (!window.location.pathname.endsWith('login.html') && !window.location.pathname.endsWith('signup.html')) {
    if (!Auth.isLoggedIn()) {
        window.location.href = 'login.html';
    }
}
