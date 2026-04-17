// plugins/pappy-radar.js
// 📡 OMEGA RADAR: Telegram Intel Bridge (SaaS Edition)

const { ownerTelegramId } = require('../config');
const logger = require('../core/logger');
const eventBus = require('../core/eventBus');

// 🧠 SaaS Fix: Utility delay to prevent Telegram Rate Limits (429)
const delay = ms => new Promise(res => setTimeout(res, ms));

module.exports = {
    category: 'INTEL',
    commands: [{ cmd: '.radars', role: 'owner' }],
    
    // 🧠 SaaS Fix: Use the global eventBus to prevent duplicate socket listeners on reconnects
    init() {
        // This listens to the event emitted by core/engine.js when a socket comes online
        eventBus.on('system.boot', async (sock) => {
            const botId = sock.user?.id?.split(':')[0] || 'Unknown Node';
            
            // 1. Initial Radar Dump on Boot
            setTimeout(async () => {
                try {
                    const groups = await sock.groupFetchAllParticipating();
                    const jids = Object.keys(groups);
                    if (jids.length === 0 || !global.tgBot) return;
                    
                    let tgMessage = `📡 <b>OMEGA BOOT: RADAR DUMP [+${botId}]</b>\n\nMonitoring <b>${jids.length}</b> sectors:\n\n`;
                    for (const jid of jids) {
                        tgMessage += `📁 <b>${groups[jid].subject || "Unknown"}</b>\n🆔 <code>${jid}</code>\n\n`;
                    }
                    
                    // Safe chunking with delays to prevent Telegram API bans
                    const chunks = tgMessage.match(/[\s\S]{1,4000}/g) || [];
                    for (const chunk of chunks) {
                        await global.tgBot.telegram.sendMessage(ownerTelegramId, chunk, { parse_mode: 'HTML' }).catch(()=>{});
                        await delay(1000); // 1-second delay between chunks
                    }
                } catch (e) {
                    logger.error(`[Radar] Boot scan failed for node +${botId}: ${e.message}`);
                }
            }, 8000);

            // 2. Real-time Territory Acquisition Listener
            // Safe to attach here because it's localized to this specific booted socket
            sock.ev.on('groups.upsert', async (newGroups) => {
                for (const group of newGroups) {
                    if (global.tgBot) {
                        global.tgBot.telegram.sendMessage(
                            ownerTelegramId, 
                            `🚨 <b>NEW TERRITORY ACQUIRED [+${botId}]</b> 🚨\n\n📁 <b>Name:</b> ${group.subject || "Unknown"}\n🆔 <b>JID:</b> <code>${group.id}</code>`, 
                            { parse_mode: 'HTML' }
                        ).catch(() => {});
                    }
                }
            });
        });
    },

    // 🧠 SaaS Fix: Updated signature to match the object destructuring in our Command Router
    execute: async ({ sock, msg, text }) => {
        const chat = msg.key.remoteJid;
        const commandName = text.split(' ')[0].toLowerCase();
        const botId = sock.user?.id?.split(':')[0] || 'Unknown Node';

        if (commandName === '.radar') {
            await sock.sendMessage(chat, { 
                text: "📡 *SCANNING SECTORS...*\n_Transmitting data securely to your Telegram._" 
            });
            
            try {
                const groups = await sock.groupFetchAllParticipating();
                const jids = Object.keys(groups);
                
                if (global.tgBot) {
                    let radarMsg = `📡 <b>OMEGA RADAR: MANUAL DUMP [+${botId}]</b>\n\nMonitoring <b>${jids.length}</b> sectors:\n\n`;
                    for (const jid of jids) {
                        radarMsg += `📁 <b>${groups[jid].subject || "Unknown"}</b>\n🆔 <code>${jid}</code>\n\n`;
                    }
                    
                    // Safe chunking with delays
                    const chunks = radarMsg.match(/[\s\S]{1,4000}/g) || [];
                    for (const chunk of chunks) {
                        await global.tgBot.telegram.sendMessage(ownerTelegramId, chunk, { parse_mode: 'HTML' }).catch(()=>{});
                        await delay(1000); // 1-second delay
                    }
                } else {
                    return sock.sendMessage(chat, { text: "❌ Telegram Control Panel is currently offline." });
                }
            } catch (err) { 
                logger.error(`[Radar] Manual scan failed: ${err.message}`);
                return sock.sendMessage(chat, { text: "❌ Radar scan failed. Check logs." }); 
            }
        }
    }
};
