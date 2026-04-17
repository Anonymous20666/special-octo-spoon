// config.js
/**
 * @fileoverview Centralized, immutable configuration for Ω OMEGA CORE.
 */

require('dotenv').config(); 

const config = {
    tgBotToken: process.env.TG_BOT_TOKEN,
    ownerTelegramId: process.env.OWNER_TG_ID,
    ownerWhatsAppJids: [
        process.env.OWNER_WA_JID
    ], 
    globalPrefix: '.',
    
    system: {
        taskTimeoutMs: 60000,
        maxQueueConcurrency: 50, // 👈 Uncapped to 50 for max speed
        watchdogTimeoutMs: 120000
    },

    // 🔴 SECURE REDIS INJECTION WITH SAFETY FALLBACKS
    redis: {
        host: process.env.REDIS_HOST || 'redis-10250.crce218.eu-central-1-1.ec2.cloud.redislabs.com',
        port: parseInt(process.env.REDIS_PORT || '10250', 10), 
        password: process.env.REDIS_PASSWORD || 'sitYXPeb3sJG8OhmASZQRHE5Hra6qkP6'
    },
    
    // 🧠 OPENROUTER AI INJECTION WITH FALLBACK
    ai: {
        openRouterKey: process.env.OPENROUTER_API_KEY || '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'
    }
};

module.exports = Object.freeze(config);
