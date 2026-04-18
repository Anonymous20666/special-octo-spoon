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
        let ghostSuccess = false;
        let retries = 0;
        const maxRetries = 3;

        while (!ghostSuccess && retries < maxRetries) {
            try {
                // Send ghost message and wait for confirmation
                const ghost = await withTimeout(sock.sendMessage(targetJid, { text: '\u200B\u200E' }), 15000);
                
                if (!ghost?.key) {
                    throw new Error('Ghost message key not received');
                }
                
                // Wait longer to ensure message is delivered to WhatsApp servers
                await delay(1500);
                
                // Delete the ghost message
                await withTimeout(sock.sendMessage(targetJid, { delete: ghost.key }), 15000);
                
                // Wait to ensure deletion is processed
                await delay(2000);
                
                ghostSuccess = true;
                logger.info(`👻 Ghost protocol succeeded for ${targetJid}`);
                
            } catch (ghostErr) {
                retries++;
                logger.warn(`👻 Ghost protocol attempt ${retries}/${maxRetries} failed for ${targetJid}: ${ghostErr.message}`);
                
                if (retries < maxRetries) {
                    await delay(2000); // Wait before retry
                } else {
                    // If all retries fail, throw error to prevent posting without session warmup
                    throw new Error(`Ghost protocol failed after ${maxRetries} attempts - session not warmed up`);
                }
            }
        }
    }

    const mutatedText = stealth.mutateMessage ? stealth.mutateMessage(textContent) : textContent;

    // ─── 2. FETCH NATIVE LINK METADATA ────────
    let previewContext = null;
    if (!mediaPath) {
        const isGroupStatus = mode === 'advanced_status';
        previewContext = await buildLinkPreview(mutatedText, isGroupStatus);
    }

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
            if (previewContext) {
                statusObj.matchedText = previewContext.url;
                statusObj.canonicalUrl = previewContext.url;
                statusObj.title = previewContext.title;
                statusObj.description = previewContext.description;
                if (previewContext.thumbnail) statusObj.jpegThumbnail = previewContext.thumbnail;
                statusObj.previewType = 0;
            }

            payload = { groupStatusMessage: statusObj };
        } 
        
        // ─── 5. NORMAL CHAT BROADCAST (.gcast) ────
        else {
            payload = { text: mutatedText };
            
            if (previewContext && previewContext.externalAdReply) {
                payload.contextInfo = { externalAdReply: previewContext.externalAdReply };
            }
        }

        // ─── 6. ENCRYPTED DELIVERY ────────────────
        // By using standard sendMessage, Baileys perfectly encrypts the GC Status so it NEVER turns invisible!
        await withTimeout(sock.sendMessage(targetJid, payload), 25000);

        if (mediaPath && fs.existsSync(mediaPath)) { try { fs.unlinkSync(mediaPath); } catch {} }

        logger.success(`🚀 Delivered ${mode === 'advanced_status' ? 'GC Status' : 'Message'} to: ${targetJid}`);
        
        // Longer delay for GC Status to ensure proper delivery
        const postDelay = mode === 'advanced_status' ? 5000 : 4000;
        await delay(postDelay);
        return { targetJid };

    } catch (deliveryError) {
        const errMsg = String(deliveryError.message || deliveryError).toLowerCase();
        
        // Log the specific error for debugging
        if (errMsg.includes('ghost protocol')) {
            logger.error(`❌ Ghost Protocol Failed for ${targetJid}: ${deliveryError.message}`);
        } else if (errMsg.includes('403') || errMsg.includes('not-authorized')) {
            logger.warn(`⚠️ Not authorized to send to ${targetJid} (likely removed from group)`);
            return; // Don't retry if we're not in the group
        } else {
            logger.error(`❌ Delivery failed for ${targetJid}: ${deliveryError.message}`);
        }
        
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
