// plugins/pappy-intel.js
// 🚀 PAPPY ULTIMATE: Aggressive Queued Auto-Joiner (SaaS Persistent Edition)

const fs = require('fs');
const path = require('path');
const { ownerTelegramId } = require('../config');
const logger = require('../core/logger');
const eventBus = require('../core/eventBus');

const dbPath = path.join(__dirname, '../data/intel.json');

// ⚙️ Aggressive Limits
const LIMITS = {
    MAX_JOINS_PER_DAY: 500,         
    MIN_COOLDOWN_MS: 10 * 1000,     
    MAX_COOLDOWN_MS: 30 * 1000      
};

// 🧠 SaaS Fix: Persistent Auto-Join State included in Cache
let intelCache = { 
    knownLinks: [], 
    pendingQueue: [], 
    dailyJoins: 0, 
    lastJoinDate: new Date().toISOString().split('T')[0],
    lastJoinTimestamp: 0,
    autoJoinEnabled: false // 🔥 Now survives server restarts!
};

// Async initialization for the database
async function initIntelDb() {
    try {
        if (!fs.existsSync(path.dirname(dbPath))) {
            await fs.promises.mkdir(path.dirname(dbPath), { recursive: true });
        }
        if (fs.existsSync(dbPath)) {
            const data = await fs.promises.readFile(dbPath, 'utf8');
            intelCache = { ...intelCache, ...JSON.parse(data) };
        }
    } catch (e) {
        logger.error(`[Intel] Failed to read intel DB, resetting state: ${e.message}`);
    }
}
initIntelDb();

// Asynchronous, non-blocking save state
async function saveState() {
    try {
        await fs.promises.writeFile(dbPath, JSON.stringify(intelCache, null, 2));
    } catch (e) {
        logger.error(`[Intel] Failed to save state to disk: ${e.message}`);
    }
}

function checkDailyReset() {
    const today = new Date().toISOString().split('T')[0];
    if (intelCache.lastJoinDate !== today) {
        intelCache.lastJoinDate = today;
        intelCache.dailyJoins = 0;
        logger.info("🔄 Daily join limits have been reset.");
        saveState();
    }
}

// ==========================================
// 🚀 THE ALWAYS-ON DAEMON ENGINE
// ==========================================

// 1. SILENT SCRAPER: Removed from init() so it runs immediately on boot!
eventBus.on('message.upsert', async (payload) => {
    try {
        const text = payload.text;
        if (!text || !text.includes('chat.whatsapp.com')) return; 

        const links = text.match(/chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/ig);
        if (links) {
            let addedToQueue = 0;
            for (let fullLink of links) {
                const code = fullLink.split('chat.whatsapp.com/')[1];
                if (!intelCache.knownLinks.includes(code) && !intelCache.pendingQueue.includes(code)) {
                    intelCache.pendingQueue.push(code);
                    addedToQueue++;
                }
            }
            if (addedToQueue > 0) {
                saveState();
                logger.info(`🕵️‍♂️ [INTEL] Intercepted ${addedToQueue} new group links. Queued.`);
            }
        }
    } catch (error) {
        logger.warn(`[INTEL] Scraper error: ${error.message}`);
    }
});

// 2. THE AGGRESSIVE AUTO-JOINER: Runs constantly in the background
setInterval(async () => {
    if (!intelCache.autoJoinEnabled || intelCache.pendingQueue.length === 0) return;
    checkDailyReset();

    const now = Date.now();
    if (intelCache.dailyJoins >= LIMITS.MAX_JOINS_PER_DAY) return; 

    const randomCooldown = Math.floor(Math.random() * (LIMITS.MAX_COOLDOWN_MS - LIMITS.MIN_COOLDOWN_MS + 1)) + LIMITS.MIN_COOLDOWN_MS;
    if (now - intelCache.lastJoinTimestamp < randomCooldown) return; 

    // Dynamically grab an active socket so the daemon survives disconnects!
    let activeSock = null;
    if (global.waSocks && global.waSocks.size > 0) {
        activeSock = Array.from(global.waSocks.values())[0];
    }
    if (!activeSock) return; 

    const nextCode = intelCache.pendingQueue.shift(); 
    intelCache.knownLinks.push(nextCode); 
    
    try {
        logger.info(`⏳ [INTEL] Attempting aggressive auto-join: ${nextCode}`);
        await new Promise(res => setTimeout(res, 2000 + Math.random() * 2000)); 
        
        const groupJid = await activeSock.groupAcceptInvite(nextCode);
        if (groupJid) {
            intelCache.dailyJoins++;
            intelCache.lastJoinTimestamp = Date.now();
            saveState();
            
            logger.success(`✅ [INTEL] Joined: ${groupJid}. (${intelCache.dailyJoins}/${LIMITS.MAX_JOINS_PER_DAY})`);
            if (global.tgBot) {
                global.tgBot.telegram.sendMessage(
                    ownerTelegramId, 
                    `🚨 <b>NEW TERRITORY SECURED</b>\n\nCode: <code>${nextCode}</code>\nDaily Limit: ${intelCache.dailyJoins}/${LIMITS.MAX_JOINS_PER_DAY}\nQueue Remaining: ${intelCache.pendingQueue.length}`, 
                    { parse_mode: 'HTML' }
                ).catch(()=>{});
            }
        }
    } catch (err) {
        logger.warn(`❌ [INTEL] Failed to join ${nextCode}. Link may be revoked or already joined.`);
        intelCache.lastJoinTimestamp = Date.now() - (LIMITS.MAX_COOLDOWN_MS - 5000);
        saveState();
    }
}, 10000);

// ==========================================
// 🎮 COMMAND EXECUTION
// ==========================================
module.exports = {
    category: 'INTEL',
    commands: [
        { cmd: '.autojoin', role: 'owner' }, // Protected to owner only
        { cmd: '.joinqueue', role: 'owner' } // Protected to owner only
    ],
    
    execute: async ({ sock, msg, args, text }) => {
        const chat = msg.key.remoteJid;
        const commandName = text.split(' ')[0].toLowerCase();

        if (commandName === '.autojoin') {
            const action = args[0]?.toLowerCase();
            if (action === 'on' || action === 'off') {
                intelCache.autoJoinEnabled = (action === 'on');
                saveState(); // 🔥 Saves it instantly so it remembers!
                
                return sock.sendMessage(chat, { 
                    text: `📡 *A U T O - J O I N :* ${intelCache.autoJoinEnabled ? 'ENGAGED 🟢' : 'OFFLINE 🔴'}`,
                    contextInfo: {
                        externalAdReply: {
                            title: "Ω INTEL ENGINE",
                            body: intelCache.autoJoinEnabled ? "Scraping & Infiltrating" : "System Paused",
                            mediaType: 1,
                            renderLargerThumbnail: true,
                            sourceUrl: "https://t.me/holyPappy"
                        }
                    }
                });
            }
            return sock.sendMessage(chat, { text: `⚙️ Status: ${intelCache.autoJoinEnabled ? 'ENGAGED 🟢' : 'OFFLINE 🛑'}\nUsage: .autojoin [on/off]` });
        }

        if (commandName === '.joinqueue') {
            checkDailyReset();
            
            const stats = `*╭━━━・ 📡 𝐈𝐍𝐓𝐄𝐋 𝐑𝐀𝐃𝐀𝐑 ・━━━╮*\n\n` +
                          `⏳ *Pending Targets:* ${intelCache.pendingQueue.length}\n` +
                          `✅ *Infiltrated Today:* ${intelCache.dailyJoins} / ${LIMITS.MAX_JOINS_PER_DAY}\n` +
                          `⚙️ *Engine Status:* ${intelCache.autoJoinEnabled ? 'ENGAGED 🟢' : 'OFFLINE 🔴'}\n\n` +
                          `*╰━━━━━━━━━━━━━━━━━━━━╯*\n\n` +
                          `_Omega Auto-Infiltration System_`;

            return sock.sendMessage(chat, { 
                text: stats,
                contextInfo: {
                    externalAdReply: {
                        title: "Ω RADAR ACTIVE",
                        body: `${intelCache.pendingQueue.length} groups in queue`,
                        mediaType: 1,
                        renderLargerThumbnail: false,
                        sourceUrl: "https://t.me/holyPappy"
                    }
                }
            });
        }
    }
};
