/**
 * services/instance.js
 *
 * Exports the single shared QueueService instance.
 * All routers import from here — one instance for the whole app.
 */

const QueueService = require('./queueService');

const queueService = new QueueService();

module.exports = queueService;
