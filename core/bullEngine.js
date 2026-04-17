// core/bullEngine.js
// 👑 SUPREME GOD MODE: ENCRYPTED GC STATUS PROTOCOL

const { Queue, Worker } = require('bullmq');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const stealth = require('./stealthEngine');
const logger = require('./logger');
const config = require('../config');
const { buildLinkPreview } = require('./linkPreview');

const nodeIdPath = path.join(__dirname, '../data/node-id.txt');
let NODE_ID = '';

if (fs.existsSync(nodeIdPath)) {
    NODE_ID = fs.readFileSync(nodeIdPath, 'utf8').trim();
} else {
    NODE_ID = 'NODE_' + crypto.randomBytes(3).toString('hex').toUpperCase();
    if (!fs.existsSync(path.dirname(nodeIdPath))) fs.mkdirSync(path.dirname(nodeIdPath), { recursive: true });
    fs.writeFileSync(nodeIdPath, NODE_ID);
}

const UNIQUE_QUEUE_NAME = `elite-broadcast-${NODE_ID}`;

const bullConfig = {
    connection: { host: config.redis.host, port: config.redis.port, password: config.redis.password, maxRetriesPerRequest: null }
};

const broadcastQueue = new Queue(UNIQUE_QUEUE_NAME, {
    ...bullConfig,
    defaultJobOptions: { attempts: 4, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: 1000 }
});

const delay = (ms) => new Promise(res => setTimeout(res, ms));

const withTimeout = (promise, ms = 20000) => {
    return Promise.race([ promise, new Promise((_, reject) => setTimeout(() => reject(new Error('WhatsApp Server Timeout')), ms)) ]);
};

const broadcastWorker = new Worker(UNIQUE_QUEUE_NAME, async (job) => {
    const { botId, targetJid, textContent, mode, useGhostProtocol, font, backgroundColor, mediaPath, isVideo } = job.data;

    let sock = null;
    if (global.waSocks) {
        for (const [sessionKey, activeSock] of global.waSocks.entries()) {
            if (sessionKey.includes(botId)) { sock = activeSock; break; }
        }
    }
    if (!sock) throw new Error(`Socket offline for bot: ${botId}`);

    // ─── 1. 👻 GHOST PROTOCOL ─────────────────
    if (useGhostProtocol) {
        try {
            const ghost = await withTimeout(sock.sendMessage(targetJid, { text: '\u200B\u200E' }), 10000);
            await delay(500);
            if (ghost?.key) await withTimeout(sock.sendMessage(targetJid, { delete: ghost.key }), 10000);
            await delay(1000);
        } catch {}
    }

    const mutatedText = stealth.mutateMessage ? stealth.mutateMessage(textContent) : textContent;

    // ─── 2. FETCH NATIVE LINK METADATA ────────
    let previewContext = null;
    if (!mediaPath) previewContext = await buildLinkPreview(mutatedText);

    try {
        let payload = {};

        // ─── 3. MEDIA HANDLING ────────────────────
        if (mediaPath && fs.existsSync(mediaPath)) {
            const mediaBuffer = fs.readFileSync(mediaPath);
            payload = isVideo ? { video: mediaBuffer, caption: mutatedText } : { image: mediaBuffer, caption: mutatedText };
        } 
        
        // ─── 4. GC STATUS (.godcast & .updategstatus) ───
        else if (mode === 'advanced_status') {
            const hexColor = (backgroundColor || '#FFB7C5').replace('#', '');
            
            // 👑 Generates the TRUE Colored GC Status Bubble
            let statusObj = {
                text: mutatedText,
                font: font !== undefined ? font : 3,
                backgroundArgb: parseInt('FF' + hexColor, 16) | 0
            };

            // Inject the Native Link Preview directly into the status bubble!
            if (previewContext && previewContext.native) {
                statusObj.matchedText = previewContext.native.url;
                statusObj.canonicalUrl = previewContext.native.url;
                statusObj.title = previewContext.native.title;
                statusObj.description = previewContext.native.description;
                if (previewContext.native.thumbnail) statusObj.jpegThumbnail = previewContext.native.thumbnail;
                statusObj.previewType = 0;
            }

            payload = { groupStatusMessage: statusObj };
        } 
        
        // ─── 5. NORMAL CHAT BROADCAST (.gcast) ────
        else {
            payload = { text: mutatedText };
            
            if (previewContext && previewContext.native) {
                payload.matchedText = previewContext.native.url;
                payload.canonicalUrl = previewContext.native.url;
                payload.title = previewContext.native.title;
                payload.description = previewContext.native.description;
                if (previewContext.native.thumbnail) payload.jpegThumbnail = previewContext.native.thumbnail;
            }
        }

        // ─── 6. ENCRYPTED DELIVERY ────────────────
        // By using standard sendMessage, Baileys perfectly encrypts the GC Status so it NEVER turns invisible!
        await withTimeout(sock.sendMessage(targetJid, payload), 25000);

        if (mediaPath && fs.existsSync(mediaPath)) { try { fs.unlinkSync(mediaPath); } catch {} }

        logger.success(`🚀 Delivered GC Status to: ${targetJid}`);
        await delay(4000);
        return { targetJid };

    } catch (deliveryError) {
        const errMsg = String(deliveryError.message || deliveryError).toLowerCase();
        if (errMsg.includes('403') || errMsg.includes('not-authorized')) return;
        throw deliveryError;
    }
}, { ...bullConfig, concurrency: 1 });

async function wipeQueue() {
    try {
        await broadcastQueue.pause();
        await broadcastQueue.drain();
        await broadcastQueue.obliterate({ force: true });
        await broadcastQueue.resume();
        return true;
    } catch { return false; }
}

module.exports = { broadcastQueue, wipeQueue };
