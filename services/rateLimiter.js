// services/rateLimiter.js
const { connection: redis } = require('./redis'); 
const logger = require('../core/logger');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 🧠 AUTO-ID: Grabs this panel's unique identity
const nodeIdPath = path.join(__dirname, '../data/node-id.txt');
let NODE_ID = '';
if (fs.existsSync(nodeIdPath)) {
    NODE_ID = fs.readFileSync(nodeIdPath, 'utf8').trim();
} else {
    NODE_ID = 'NODE_' + crypto.randomBytes(3).toString('hex').toUpperCase();
    if (!fs.existsSync(path.dirname(nodeIdPath))) fs.mkdirSync(path.dirname(nodeIdPath), { recursive: true });
    fs.writeFileSync(nodeIdPath, NODE_ID);
}

// Cooldown Limits in milliseconds
const LIMITS = { user: 1000, group: 500, globalFlood: 50 };

class RateLimiter {
    constructor() {
        this.lastGlobalMessage = 0;
    }

    async check(userId, groupId = null) {
        const now = Date.now();
        
        // Reduced global flood protection
        if (now - this.lastGlobalMessage < LIMITS.globalFlood) return false;
        this.lastGlobalMessage = now;

        try {
            const userKey = `ratelimit:${NODE_ID}:user:${userId}`;
            const userSet = await redis.set(userKey, '1', 'PX', LIMITS.user, 'NX');
            if (!userSet) return false; 

            if (groupId) {
                const groupKey = `ratelimit:${NODE_ID}:group:${groupId}`;
                const groupSet = await redis.set(groupKey, '1', 'PX', LIMITS.group, 'NX');
                if (!groupSet) return false; 
            }

            return true; 
        } catch (error) {
            logger.error('[RATE LIMITER] Redis check failed:', error.message);
            return true; 
        }
    }
}

module.exports = new RateLimiter();
