// core/ai.memory.js
const { connection: redis } = require('../services/redis');
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

async function getMemory(userId) {
    try {
        // 👈 FIX: Appended NODE_ID so bots don't read each other's memories
        const key = `ai_memory:${NODE_ID}:${userId}`;
        const data = await redis.lrange(key, 0, 9);
        return data.map(str => JSON.parse(str)).reverse();
    } catch (err) {
        return [];
    }
}

async function updateMemory(userId, userText, aiText) {
    try {
        // 👈 FIX: Appended NODE_ID
        const key = `ai_memory:${NODE_ID}:${userId}`;
        const entry = JSON.stringify({ user: userText, ai: aiText });
        await redis.lpush(key, entry);
        await redis.ltrim(key, 0, 9); 
        await redis.expire(key, 3600); // 1 hour memory expiration
    } catch (err) {
        // Safe fail
    }
}

module.exports = { getMemory, updateMemory };
