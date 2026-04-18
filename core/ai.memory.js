'use strict';
// core/ai.memory.js — Redis-backed conversation memory

const { connection: redis } = require('../services/redis');
const logger  = require('./logger');
const NODE_ID = require('../utils/nodeId');
const { safeJsonParse } = require('../utils/validator');

async function getMemory(userId) {
    try {
        const key  = `ai_memory:${NODE_ID}:${userId}`;
        const data = await redis.lrange(key, 0, 9);
        return data
            .map((str) => safeJsonParse(str))   // Fix: safeJsonParse instead of bare JSON.parse
            .filter(Boolean)
            .reverse();
    } catch (err) {
        logger.warn('[AI Memory] getMemory failed', { error: err.message });
        return [];
    }
}

async function updateMemory(userId, userText, aiText) {
    try {
        const key   = `ai_memory:${NODE_ID}:${userId}`;
        const entry = JSON.stringify({ user: userText, ai: aiText });
        await redis.lpush(key, entry);
        await redis.ltrim(key, 0, 19);  // keep last 20 exchanges
        await redis.expire(key, 86400); // 24 hours
    } catch (err) {
        logger.warn('[AI Memory] updateMemory failed', { error: err.message });
    }
}

module.exports = { getMemory, updateMemory };
