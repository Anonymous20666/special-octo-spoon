// core/statusManager.js
const logger = require('./logger');
const { buildLinkPreview } = require('./linkPreview');

// 🛡️ MEMORY FIX: WeakMap automatically garbage-collects cache when a session is deleted
const sessionGroupCache = new WeakMap();

/**
 * Fetches all participating group JIDs for the bot, using a WeakMap cache.
 * @param {Object} sock - The Baileys socket connection.
 * @returns {Promise<string[]>} Array of group JIDs.
 */
async function getGroups(sock) {
    const botId = sock.user?.id?.split(':')[0];
    if (!botId) {
        logger.error("Socket user ID not found. Cannot fetch groups.");
        return [];
    }

    const now = Date.now();
    let cache = sessionGroupCache.get(sock) || { jids: [], lastFetch: 0 };

    // Refresh cache every 10 minutes
    if (now - cache.lastFetch > 600000 || cache.jids.length === 0) {
        try {
            const groups = await sock.groupFetchAllParticipating();
            cache.jids = Object.keys(groups);
            cache.lastFetch = now;
            sessionGroupCache.set(sock, cache);
            logger.info(`[${botId}] Group cache refreshed (${cache.jids.length} groups)`);
        } catch (err) {
            logger.error(`[${botId}] Failed to fetch groups, using stale cache.`, err);
            return cache.jids; 
        }
    }

    return cache.jids;
}

/**
 * Posts a text status to all participating groups.
 * @param {Object} sock - The Baileys socket connection.
 * @param {string} text - The message to post.
 * @param {Object} [nativeContextInfo=null] - Optional native WhatsApp contextInfo (for native previews).
 * @returns {Promise<boolean>} True if successful, false otherwise.
 */
async function postTextStatus(sock, text, nativeContextInfo = null) {
    try {
        const groupJids = await getGroups(sock);
        
        if (!groupJids || groupJids.length === 0) {
            logger.warn(`[${sock.user?.id?.split(':')[0]}] No groups found for status broadcast`);
            return false;
        }

        const statusPayload = {
            text: `Ω ELITE BROADCAST\n\n${text}`
        };

        // 🧠 SaaS Logic: Prioritize native WhatsApp preview, otherwise generate our own!
        if (nativeContextInfo) {
            statusPayload.contextInfo = nativeContextInfo;
            // Ensure large rendering for native previews
            if (statusPayload.contextInfo.externalAdReply) {
                statusPayload.contextInfo.externalAdReply.renderLargerThumbnail = true;
            }
        } else {
            // No native info? Try our own SaaS link scraper
            const generatedPreview = await buildLinkPreview(text);
            if (generatedPreview) {
                statusPayload.contextInfo = generatedPreview;
            }
        }

        await sock.sendMessage(
            "status@broadcast",
            statusPayload,
            { statusJidList: groupJids }
        );

        logger.success(`[${sock.user?.id?.split(':')[0]}] Status successfully posted to ${groupJids.length} targets`);
        return true;

    } catch (error) {
        logger.error("Status broadcast failed:", error.message || error);
        return false;
    }
}

module.exports = { postTextStatus, getGroups };
