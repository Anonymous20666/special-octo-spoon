// core/watchdog.js
// 🐕 SMART WATCHDOG: Active Memory & Task Monitoring

const logger = require('./logger');
const taskManager = require('./taskManager');

class SmartWatchdog {
    constructor(timeoutMs = 120000) { 
        this.timeoutMs = timeoutMs;
        this.monitors = new Map();
        
        // System Health Check every 60 seconds
        this.healthCheckInterval = setInterval(() => this.runDiagnostics(), 60000);
    }

    attach(botId, sock, restartCallback) {
        if (this.monitors.has(botId)) clearInterval(this.monitors.get(botId).interval);

        const monitor = {
            lastSeen: Date.now(),
            interval: setInterval(() => this._check(botId, sock, restartCallback), 30000)
        };

        this.monitors.set(botId, monitor);
        sock.ws.on('message', () => this.update(botId));
    }

    detach(botId) {
        const monitor = this.monitors.get(botId);
        if (monitor) {
            clearInterval(monitor.interval);
            this.monitors.delete(botId);
            logger.info(`[WATCHDOG] Detached monitor for ${botId} (session purged).`);
        }
    }

    update(botId) {
        const monitor = this.monitors.get(botId);
        if (monitor) monitor.lastSeen = Date.now();
    }

    _check(botId, sock, restartCallback) {
        const monitor = this.monitors.get(botId);
        if (!monitor) return;

        const idleTime = Date.now() - monitor.lastSeen;

        if (idleTime > (this.timeoutMs / 2)) {
            try { sock.ws.ping(); }
            catch (e) { logger.warn(`[WATCHDOG] Failed to ping socket for ${botId}.`); }
        }

        if (idleTime > this.timeoutMs) {
            logger.error(`🚨 [WATCHDOG] Zombie connection detected for ${botId}. Force restarting...`);
            clearInterval(monitor.interval);
            this.monitors.delete(botId);
            // Guard: only restart if session folder still exists on disk
            const path = require('path');
            const fs   = require('fs');
            const sessionsPath = path.join(__dirname, '../data/sessions');
            const hasSessions  = fs.existsSync(sessionsPath) &&
                fs.readdirSync(sessionsPath).some(f => f.includes(botId));
            if (!hasSessions) {
                logger.warn(`[WATCHDOG] No session found for ${botId} — skipping restart.`);
                return;
            }
            restartCallback();
        }
    }

    runDiagnostics() {
        const stats = taskManager.getStats();
        const mem = process.memoryUsage();
        const memoryMB = Math.round(mem.rss / 1024 / 1024);

        // 🛑 Detect stuck tasks (e.g., if WhatsApp bans an action and the queue freezes)
        if (stats.queued > 100 && stats.running >= taskManager.concurrency) {
            logger.warn('🚨 [WATCHDOG] High queue congestion detected. Flushing low-priority tasks...');
            // Keep priority 3 and above, dump the rest to save the engine
            taskManager.queue = taskManager.queue.filter(job => job.priority >= 3);
        }

        // 🛑 Critical Memory Leak Guard
        if (memoryMB > 1024) { 
            logger.error('🚨 [WATCHDOG] CRITICAL MEMORY USAGE. Forcing Cache Clear.');
            if (global.gc) global.gc(); // Requires node --expose-gc
            global.messageCache = new WeakMap(); // Reset Baileys message cache
        }
    }
}

module.exports = new SmartWatchdog();
