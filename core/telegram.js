// core/telegram.js
// 🌐 SAAS DASHBOARD: Enterprise API 9.4 Colored UI & Universal Bridge

'use strict';
const { Telegraf } = require('telegraf');
const fsp  = require('fs').promises;
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const axios = require('axios');

const { tgBotToken, ownerTelegramId } = require('../config');
const ownerManager = require('../modules/ownerManager');
const { startWhatsApp, activeSockets, botState, saveState } = require('./whatsapp');
const logger      = require('./logger');
const taskManager = require('./taskManager');
const Intel       = require('./models/Intel');
// Fix: static imports — eliminates all dynamic require(variable) for bullEngine
const { broadcastQueue } = require('./bullEngine');
// Fix: static import for groupstatus plugin — eliminates getGsPlugin() dynamic require
const gsPlugin = (() => { try { return require('../plugins/pappy-groupstatus'); } catch (e) { logger.warn('GroupStatus plugin not loaded'); return null; } })();

const SESSIONS_PATH = path.join(__dirname, '../data/sessions');
const PLUGINS_DIR   = path.resolve(__dirname, '../plugins');

// Fix: static import for AI — eliminates try/catch dynamic require
let ai = null;
try { ai = require('./ai'); } catch (e) { logger.warn('AI Module offline'); }

// Fix: static plugin registry built once at startup — eliminates dynamic
// require(variable) in the Telegram bridge (lazy-load-module fix).
// Maps commandName → plugin module.
const PLUGIN_REGISTRY = new Map();
(function buildRegistry() {
    if (!fs.existsSync(PLUGINS_DIR)) return;
    const files = fs.readdirSync(PLUGINS_DIR).filter(f => f.endsWith('.js'));
    for (const file of files) {
        const filePath = path.join(PLUGINS_DIR, path.basename(file));
        try {
            const plugin = require(filePath);
            if (plugin.commands && Array.isArray(plugin.commands)) {
                plugin.commands.forEach(c => PLUGIN_REGISTRY.set(c.cmd.toLowerCase(), plugin));
            }
        } catch (err) {
            logger.error(`[Telegram] Failed to load plugin ${file}`, { error: err.message });
        }
    }
})();

// Fix: getDynamicPlugins now reads from the static registry — no dynamic require
function getDynamicPlugins() {
    const categories = {};
    for (const [cmd, plugin] of PLUGIN_REGISTRY.entries()) {
        if (!plugin.category) continue;
        const cat = plugin.category.toUpperCase();
        if (!categories[cat]) categories[cat] = [];
        if (!categories[cat].includes(cmd)) categories[cat].push(cmd);
    }
    return categories;
}

// 🎨 SAAS UI: Telegram API 9.4+ Inline Keyboard Colors
function getMainDashboardMenu() {
    const text = `
◈ ━━━━━━ <b>Ω PAPPY ULTIMATE</b> ━━━━━━ ◈
   <i>Enterprise Growth Engine</i>
◈ ━━━━━━━━━━━━━━━━━━━━━━━━ ◈

🟢 <b>ENGINE STATUS:</b> <code>${botState.isSleeping ? 'SLEEPING (PAUSED)' : 'ONLINE & SECURE'}</code>
🌐 <b>ACTIVE NODES:</b> <code>${activeSockets.size}</code> ${activeSockets.size === 0 ? '⏳ booting...' : Array.from(activeSockets.values()).filter(s => s?.user).length + ' online'}

<i>Select an option or send a WhatsApp command directly:</i>`;

    const reply_markup = {
        inline_keyboard: [
            [{ text: '🚀 Manage Active Nodes', callback_data: 'menu_nodes', style: 'primary' }],
            [{ text: '🧠 Omega AI Assistant', callback_data: 'cmd_ai_help', style: 'primary' }],
            [
                { text: '➕ Deploy Node', callback_data: 'help_pair', style: 'success' }, 
                { text: '📊 Analytics', callback_data: 'cmd_analytics', style: 'primary' }
            ],
            [{ text: '📚 Dynamic Command Book', callback_data: 'cmd_plugins', style: 'primary' }],
            [{ text: '🗑️ Wipe Redis Queue', callback_data: 'cmd_wipequeue', style: 'danger' }],
            [{ text: '🧠 Change AI Prompt', callback_data: 'cmd_ai_prompt' }],
            [{ text: '👑 Manage Sudo Users', callback_data: 'menu_sudo', style: 'primary' }],
            [{ 
                text: botState.isSleeping ? '🟢 Wake Engine' : '🛑 Sleep Engine', 
                callback_data: botState.isSleeping ? 'cmd_wake' : 'cmd_sleep', 
                style: botState.isSleeping ? 'success' : 'danger' 
            }],
            [{ text: '🔄 Restart Entire System', callback_data: 'cmd_restart', style: 'danger' }],
            [{ text: '💬 Send Suggestion / Report', callback_data: 'cmd_suggest', style: 'primary' }]
        ]
    };
    return { text, reply_markup };
}

// Prompt file path — persists custom AI prompt across restarts
const PROMPT_FILE = path.join(__dirname, '../data/ai_prompt.txt');

function getCustomPrompt() {
    try { return fs.readFileSync(PROMPT_FILE, 'utf8').trim(); } catch { return null; }
}
async function saveCustomPrompt(text) {
    await fsp.mkdir(path.dirname(PROMPT_FILE), { recursive: true });
    await fsp.writeFile(PROMPT_FILE, text, 'utf8');
}

// Expose getter so ai.js can read it
module.exports._getCustomPrompt = getCustomPrompt;

async function startTelegram() {
    const bot = new Telegraf(tgBotToken);
    global.tgBot = bot;

    // Security Middleware
    bot.use((ctx, next) => {
        if (ctx.from?.id.toString() !== ownerTelegramId) return;
        return next();
    });

    // ==========================================
    // 🎛️ MAIN MENU ROUTING
    // ==========================================
    bot.command('start', (ctx) => {
        const { text, reply_markup } = getMainDashboardMenu();
        ctx.reply(text, { parse_mode: 'HTML', reply_markup });
    });

    bot.action('menu_main', (ctx) => {
        ctx.answerCbQuery();
        const { text, reply_markup } = getMainDashboardMenu();
        ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup }).catch((e) => logger.warn('Telegram API call failed', { error: e.message }));
    });

    // ==========================================
    // 🌐 ACTIVE NODES SUBMENU
    // ==========================================
    bot.action('menu_nodes', (ctx) => {
        ctx.answerCbQuery();
        if (activeSockets.size === 0) {
            return ctx.editMessageText('🔴 <b>NO ACTIVE SESSIONS</b>\nClick "Deploy Node" on the main menu to pair a number.', { 
                parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Hub', callback_data: 'menu_main' }]] }
            }).catch((e) => logger.warn('Telegram API call failed', { error: e.message }));
        }
        
        const inline_keyboard = [];
        activeSockets.forEach((sock, key) => {
            const phone = key.split('_')[1] || key;
            const status = sock?.user ? '🟢' : '⏳';
            inline_keyboard.push([{ text: `${status} Node +${phone}`, callback_data: `node_${key}`, style: 'primary' }]);
        });
        inline_keyboard.push([{ text: '🔙 Back to Hub', callback_data: 'menu_main' }]);

        ctx.editMessageText('🌐 <b>SELECT A NODE TO MANAGE:</b>', { parse_mode: 'HTML', reply_markup: { inline_keyboard } }).catch((e) => logger.warn('Telegram API call failed', { error: e.message }));
    });

    // ==========================================
    // ⚙️ ULTIMATE PER-SESSION CONTROL PANEL
    // ==========================================
    bot.action(/^node_(.+)$/, (ctx) => {
        ctx.answerCbQuery();
        const sessionKey = ctx.match[1];
        const phone = sessionKey.split('_')[1] || sessionKey;
        const isOnline = activeSockets.get(sessionKey)?.user ? 'Online 🟢' : 'Connecting/Offline ⏳';
        
        const text = `📱 <b>NODE CONTROL: +${phone}</b>\n\n<b>Status:</b> ${isOnline}\n\n<i>Select a management protocol for this specific number:</i>`;
        
        const reply_markup = {
            inline_keyboard: [
                [ 
                    { text: '🔄 Restart Node', callback_data: `restart_node_${sessionKey}`, style: 'primary' }, 
                    { text: '🗑️ Purge Node', callback_data: `purge_node_${sessionKey}`, style: 'danger' } 
                ],
                [ { text: '📡 Broadcast & Godcast', callback_data: `bcast_node_${sessionKey}`, style: 'primary' } ],
                [ { text: '🎯 Nexus Sniper', callback_data: `nexus_node_${sessionKey}`, style: 'primary' } ],
                [ 
                    { text: '💬 Send DM', callback_data: `dm_node_${sessionKey}`, style: 'primary' }, 
                    { text: '🖼️ Upload Status', callback_data: `status_node_${sessionKey}`, style: 'primary' } 
                ],
                [ { text: '📸 Group Status (Config)', callback_data: `gstatus_node_${sessionKey}`, style: 'success' } ],
                [ { text: '🌟 Set GC Status', callback_data: `setnewgcstatus_node_${sessionKey}`, style: 'success' } ],
                [ { text: '🔗 Join Intel GCs', callback_data: `intel_join_${sessionKey}`, style: 'success' } ],
                [ { text: '📤 Send All Intel Links', callback_data: `intel_send_${sessionKey}` }, { text: '🗑️ Clear Intel DB', callback_data: `intel_clear_${sessionKey}` } ],
                [ { text: '🔙 Back to Nodes', callback_data: 'menu_nodes' } ]
            ]
        };

        ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup }).catch((e) => logger.warn('Telegram API call failed', { error: e.message }));
    });

    // ─── INTEL GC JOIN (per node, slow & safe) ───────────────────────────────
    bot.action(/^intel_join_(.+)$/, async (ctx) => {
        ctx.answerCbQuery('Starting Intel GC join...').catch(() => {});
        const sessionKey = ctx.match[1];
        const sock = activeSockets.get(sessionKey);
        const phone = sessionKey.split('_')[1] || sessionKey;

        if (!sock?.user) {
            return ctx.editMessageText('❌ <b>Node is offline.</b> Restart it first.', {
                parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: `node_${sessionKey}` }]] }
            }).catch(() => {});
        }

        const intelPath = path.join(__dirname, '../data/intel.json');
        let intel;
        try {
            intel = JSON.parse(await fsp.readFile(intelPath, 'utf8'));
        } catch {
            return ctx.editMessageText('❌ <b>Intel DB not found.</b>', {
                parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: `node_${sessionKey}` }]] }
            }).catch(() => {});
        }

        const codes = intel.knownLinks || [];
        if (codes.length === 0) {
            return ctx.editMessageText('⚠️ <b>No GC links in Intel DB.</b>', {
                parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: `node_${sessionKey}` }]] }
            }).catch(() => {});
        }

        // Fetch groups node is already in
        let alreadyIn = new Set();
        try {
            const groups = await sock.groupFetchAllParticipating();
            for (const g of Object.values(groups)) alreadyIn.add(g.id);
        } catch { /* non-fatal */ }

        const statusMsg = await ctx.editMessageText(
            `🔗 <b>INTEL GC JOIN STARTED</b>\n📱 Node: +${phone}\n📦 Total codes: <b>${codes.length}</b>\n🏠 Already in: <b>${alreadyIn.size}</b> groups\n\n⏳ Scanning & joining slowly...`,
            { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Node', callback_data: `node_${sessionKey}` }]] } }
        ).catch(() => null);

        const log = [];
        const pushLog = (line) => { log.unshift(line); if (log.length > 8) log.pop(); };

        const updateMsg = async (done, total, header) => {
            if (!statusMsg) return;
            await global.tgBot.telegram.editMessageText(
                ctx.chat.id, statusMsg.message_id, null,
                `🔗 <b>INTEL GC JOIN — ${header}</b>\n📱 Node: +${phone}\n📊 Progress: <b>${done}/${total}</b>\n\n<code>${log.join('\n')}</code>`,
                { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Node', callback_data: `node_${sessionKey}` }]] } }
            ).catch(() => {});
        };

        // Run in background — save progress so it can resume after restart
        const resumePath = path.join(__dirname, `../data/intel_join_${sessionKey}.json`);
        let startIndex = 0;
        try {
            const saved = JSON.parse(await fsp.readFile(resumePath, 'utf8'));
            if (saved.lastIndex) startIndex = saved.lastIndex;
        } catch {}

        (async () => {
            let joined = 0, requested = 0, skipped = 0, failed = 0;

            for (let i = startIndex; i < codes.length; i++) {
                // Save progress every 5 joins so restart can resume
                if (i % 5 === 0) await fsp.writeFile(resumePath, JSON.stringify({ lastIndex: i, sessionKey }), 'utf8').catch(() => {});

                if (!activeSockets.has(sessionKey)) {
                    pushLog('⚠️ Node went offline — stopping.');
                    await updateMsg(i, codes.length, 'STOPPED');
                    break;
                }

                const code = codes[i];
                const shortCode = code.slice(0, 10) + '...';

                try {
                    const result = await sock.groupAcceptInvite(code);
                    if (result && typeof result === 'string') {
                        joined++;
                        pushLog(`✅ Joined: ${result.split('@')[0]}`);
                    } else {
                        // null result = approval/request needed
                        requested++;
                        pushLog(`📨 Requested: ${shortCode}`);
                    }
                } catch (err) {
                    const m = err.message?.toLowerCase() || '';
                    if (m.includes('already') || m.includes('already-participant')) {
                        skipped++;
                        pushLog(`⏭️ Already in: ${shortCode}`);
                    } else if (
                        m.includes('gone') || m.includes('not-found') ||
                        m.includes('revoked') || m.includes('404') ||
                        m.includes('bad-request') || m.includes('bad_request') ||
                        m.includes('invalid') || m.includes('expired') ||
                        m.includes('rate-overlimit')
                    ) {
                        skipped++;
                        pushLog(`🗑️ Dead/invalid: ${shortCode}`);
                    } else if (m.includes('403') || m.includes('forbidden')) {
                        skipped++;
                        pushLog(`🚫 Restricted: ${shortCode}`);
                    } else if (m.includes('rate') || m.includes('429') || m.includes('too many')) {
                        // Rate limited — pause 60s then continue
                        pushLog(`⏳ Rate limit hit — pausing 60s...`);
                        await updateMsg(i + 1, codes.length, 'RATE LIMITED — PAUSING');
                        await new Promise(res => setTimeout(res, 60000));
                        failed++;
                    } else {
                        failed++;
                        pushLog(`❌ Failed: ${shortCode} — ${err.message.slice(0, 25)}`);
                        logger.warn(`[Intel Join] ${code}: ${err.message}`);
                    }
                }

                // Live update every 5 codes
                if ((i + 1) % 5 === 0) await updateMsg(i + 1, codes.length, 'IN PROGRESS');

                // 20–40s random delay between joins
                if (i < codes.length - 1) {
                    await new Promise(res => setTimeout(res, 20000 + Math.random() * 20000));
                }
            }

            // Final summary — clear resume file
            await fsp.unlink(resumePath).catch(() => {});
            if (statusMsg) {
                await global.tgBot.telegram.editMessageText(
                    ctx.chat.id, statusMsg.message_id, null,
                    `✅ <b>INTEL GC JOIN COMPLETE</b>\n📱 Node: +${phone}\n\n✅ Joined: <b>${joined}</b>\n📨 Requested (approval needed): <b>${requested}</b>\n⏭️ Skipped (dead/already in): <b>${skipped}</b>\n❌ Failed: <b>${failed}</b>`,
                    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Node', callback_data: `node_${sessionKey}` }]] } }
                ).catch(() => {});
            }
        })();
    });

    // ─── INTEL SEND ALL LINKS ───────────────────────────────────────────────
    bot.action(/^intel_send_(.+)$/, async (ctx) => {
        ctx.answerCbQuery('Sending links...').catch(() => {});
        const sessionKey = ctx.match[1];
        const intelPath = path.join(__dirname, '../data/intel.json');
        let intel;
        try { intel = JSON.parse(await fsp.readFile(intelPath, 'utf8')); } catch {
            return ctx.editMessageText('❌ Intel DB not found.', { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: `node_${sessionKey}` }]] } }).catch(() => {});
        }
        const codes = intel.knownLinks || [];
        if (codes.length === 0) return ctx.editMessageText('⚠️ No links in Intel DB.', { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: `node_${sessionKey}` }]] } }).catch(() => {});

        // Split into chunks of 50 links per message
        const chunkSize = 50;
        const links = codes.map(c => `https://chat.whatsapp.com/${c}`);
        for (let i = 0; i < links.length; i += chunkSize) {
            const chunk = links.slice(i, i + chunkSize).join('\n');
            await ctx.reply(`🔗 <b>Intel Links ${i + 1}–${Math.min(i + chunkSize, links.length)} of ${links.length}:</b>\n\n${chunk}`, { parse_mode: 'HTML' }).catch(() => {});
        }
        ctx.reply(`✅ Sent all <b>${links.length}</b> intel links.`, { parse_mode: 'HTML' }).catch(() => {});
    });

    // ─── INTEL CLEAR DB ────────────────────────────────────────────────────
    bot.action(/^intel_clear_(.+)$/, async (ctx) => {
        ctx.answerCbQuery().catch(() => {});
        const sessionKey = ctx.match[1];
        ctx.editMessageText('⚠️ <b>Are you sure?</b>\nThis will delete ALL intel links permanently.', {
            parse_mode: 'HTML', reply_markup: { inline_keyboard: [
                [{ text: '✅ Yes, wipe it', callback_data: `intel_clear_confirm_${sessionKey}` }, { text: '❌ Cancel', callback_data: `node_${sessionKey}` }]
            ]}
        }).catch(() => {});
    });

    bot.action(/^intel_clear_confirm_(.+)$/, async (ctx) => {
        ctx.answerCbQuery('Wiping Intel DB...').catch(() => {});
        const sessionKey = ctx.match[1];
        const intelPath = path.join(__dirname, '../data/intel.json');
        const empty = { knownLinks: [], pendingQueue: [], dailyJoins: 0, lastJoinDate: new Date().toISOString().split('T')[0], autoJoinEnabled: false, lastJoinTimestamp: 0 };
        await fsp.writeFile(intelPath, JSON.stringify(empty, null, 2), 'utf8').catch(() => {});
        ctx.editMessageText('✅ <b>Intel DB wiped.</b> All links deleted.', {
            parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Node', callback_data: `node_${sessionKey}` }]] }
        }).catch(() => {});
    });

    // ─── PER-SESSION ACTIONS ──────────────────────────────────────────────────
    bot.action(/^restart_node_(.+)$/, async (ctx) => {
        ctx.answerCbQuery('Restarting node...');
        const sessionKey = ctx.match[1];
        const parts = sessionKey.split('_');
        
        const sock = activeSockets.get(sessionKey);
        if (sock) {
            try { sock.ws.close(); } catch(e) { logger.warn('ws.close failed', { error: e.message }); }
            activeSockets.delete(sessionKey);
        }
        
        ctx.editMessageText(`🔄 <b>RESTARTING NODE +${parts[1]}...</b>\nAllow up to 10 seconds for the node to reconnect to WhatsApp.`, {
            parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Nodes', callback_data: 'menu_nodes' }]] }
        }).catch((e) => logger.warn('Telegram API call failed', { error: e.message }));

        setTimeout(() => { startWhatsApp(parts[0], parts[1], parts[2] || '1', true).catch(e => logger.error(e)); }, 3000);
    });

    bot.action(/^purge_node_(.+)$/, async (ctx) => {
        ctx.answerCbQuery('Purging Node...');
        const sessionKey = ctx.match[1];
        const parts      = sessionKey.split('_');
        const phoneNumber = parts[1];
        const sock = activeSockets.get(sessionKey);

        if (sock) {
            try { sock.logout(); } catch(e) { sock.ws.close(); }
            activeSockets.delete(sessionKey);
        }

        const sessionDir = path.join(SESSIONS_PATH, path.basename(sessionKey));
        try { await fsp.rm(sessionDir, { recursive: true, force: true }); } catch (e) { logger.warn('Failed to rm session dir', { error: e.message }); }

        // Clean up DB, ownerManager and pairingRegistry
        try {
            const ownerMgr   = require('../modules/ownerManager');
            const pairingReg = require('../modules/pairingRegistry');
            const User       = require('../core/models/User');
            const purgedJid  = `${phoneNumber}@s.whatsapp.net`;
            await ownerMgr.removeOwner(purgedJid).catch(() => {});
            await pairingReg.unregister(ctx.from.id.toString()).catch(() => {});
            await User.deleteOne({ userId: purgedJid }).catch(() => {});
        } catch {}

        ctx.editMessageText(`🗑️ <b>NODE PURGED</b>\nSession + DB records permanently destroyed.`, {
            parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Nodes', callback_data: 'menu_nodes' }]] }
        }).catch((e) => logger.warn('editMessageText failed', { error: e.message }));
    });

    bot.action(/^bcast_node_(.+)$/, (ctx) => {
        ctx.answerCbQuery();
        const text = `📡 <b>BROADCAST TOOLS</b>\n\nYou can use the Universal Bridge to control this node by typing commands directly in Telegram:\n\n• <b>Godcast:</b> <code>.godcast Your Message</code>\n• <b>Standard Gcast:</b> <code>.gcast Your Message</code>\n• <b>Schedule:</b> <code>.schedulecast 15m Message</code>`;
        ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Node', callback_data: `node_${ctx.match[1]}` }]] } }).catch((e) => logger.warn('Telegram API call failed', { error: e.message }));
    });

    bot.action(/^nexus_node_(.+)$/, (ctx) => {
        ctx.answerCbQuery();
        const text = `🎯 <b>NEXUS SNIPER PROTOCOL</b>\n\nTo silently infiltrate a group and DM its members, type:\n\n<code>.nexus [group_jid] [Your message]</code>\n\n<i>Tip: Use {group} in your text to magically insert the group's name so it looks human.</i>`;
        ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Node', callback_data: `node_${ctx.match[1]}` }]] } }).catch((e) => logger.warn('Telegram API call failed', { error: e.message }));
    });

    bot.action(/^dm_node_(.+)$/, (ctx) => {
        ctx.answerCbQuery();
        const text = `💬 <b>DIRECT MESSAGE</b>\n\nTo send a DM via this node, type:\n\n<code>/dm [phone_number] [message]</code>`;
        ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Node', callback_data: `node_${ctx.match[1]}` }]] } }).catch((e) => logger.warn('Telegram API call failed', { error: e.message }));
    });

    bot.action(/^status_node_(.+)$/, (ctx) => {
        ctx.answerCbQuery();
        const text = `🖼️ <b>UPLOAD STATUS / MEDIA</b>\n\n• <b>Text Status:</b> <code>/status [message]</code>\n• <b>Media Status:</b> Send a Photo/Video to this Telegram bot with the caption <code>/castmedia</code>.`;
        ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Node', callback_data: `node_${ctx.match[1]}` }]] } }).catch((e) => logger.warn('Telegram API call failed', { error: e.message }));
    });

    // ==========================================
    // 📸 GROUP STATUS SUBMENU (Dynamic Menu Engine)
    // ==========================================
    function buildGsMenu(sessionKey) {
        const gs  = gsPlugin;
        const cfg = gs ? gs.getGsConfig() : { backgroundColor: '#000000', font: 0, repeat: 1 };
        const BG_COLORS = gs?.BG_COLORS || {};
        const FONTS     = gs?.FONTS || {};
        const colorName = Object.keys(BG_COLORS).find(k => BG_COLORS[k] === cfg.backgroundColor) || cfg.backgroundColor;
        const fontName  = Object.keys(FONTS).find(k => FONTS[k] === cfg.font) || String(cfg.font);
        const text = `📸 <b>GROUP STATUS ENGINE</b>\n\n🎨 Background : <code>${colorName}</code>\n🖊️ Font : <code>${fontName}</code>\n🔁 Repeat : <code>${cfg.repeat}×</code>\n\n<i>Post a story to all groups this node is in.</i>`;
        const reply_markup = {
            inline_keyboard: [
                [ { text: '🎨 Change Color', callback_data: `gs_color_${sessionKey}`, style: 'primary' }, { text: '🖊️ Change Font', callback_data: `gs_font_${sessionKey}`, style: 'primary' } ],
                [ { text: '🔁 Set Repeat', callback_data: `gs_repeat_${sessionKey}`, style: 'primary' }, { text: '🗑️ Reset Config', callback_data: `gs_reset_${sessionKey}`, style: 'danger' } ],
                [ { text: '📤 Post Now', callback_data: `gs_postnow_${sessionKey}`, style: 'success' } ],
                [ { text: '🔙 Back to Node', callback_data: `node_${sessionKey}` } ]
            ]
        };
        return { text, reply_markup };
    }

    bot.action(/^gstatus_node_(.+)$/, (ctx) => {
        ctx.answerCbQuery();
        const { text, reply_markup } = buildGsMenu(ctx.match[1]);
        ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup }).catch((e) => logger.warn('Telegram API call failed', { error: e.message }));
    });

    // ─── SET GC STATUS PER NODE ───────────────────────────────────────────────
    bot.action(/^setnewgcstatus_node_(.+)$/, (ctx) => {
        ctx.answerCbQuery();
        const sessionKey = ctx.match[1];
        ctx.session = ctx.session || {};
        ctx.session.gcStatusNode = sessionKey;
        ctx.editMessageText(
            `🌟 <b>SET GC STATUS</b>\n\nNode: <code>+${sessionKey.split('_')[1]}</code>\n\nSend your text or link below.\nOr reply to an image/video to use it as media status.`,
            { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Cancel', callback_data: `node_${sessionKey}` }]] } }
        ).catch(() => {});
    });

    bot.action(/^gs_reset_(.+)$/, (ctx) => {
        ctx.answerCbQuery('Config reset.');
        if (gsPlugin) gsPlugin.setGsConfig({ backgroundColor: gsPlugin.BG_COLORS.black, font: gsPlugin.FONTS.sans, repeat: 1 });
        const { text, reply_markup } = buildGsMenu(ctx.match[1]);
        ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup }).catch((e) => logger.warn('editMessageText failed', { error: e.message }));
    });

    bot.action(/^gs_postnow_(.+)$/, (ctx) => {
        ctx.answerCbQuery();
        ctx.editMessageText(
            `📤 <b>POST GROUP STATUS</b>\n\nSend your text or link as:\n<code>/updategstatus Your text or https://link.here</code>\n\n<i>Current config will be applied automatically.</i>`,
            { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: `gstatus_node_${ctx.match[1]}` }]] } }
        ).catch((e) => logger.warn('Telegram API call failed', { error: e.message }));
    });

    // ==========================================
    // 🧠 AI PROMPT EDITOR
    // ==========================================
    bot.action('cmd_ai_prompt', async (ctx) => {
        ctx.answerCbQuery();
        const current = getCustomPrompt() || '(using default prompt)';
        const preview = current.length > 300 ? current.slice(0, 300) + '...' : current;
        ctx.editMessageText(
            `🧠 <b>AI PROMPT EDITOR</b>\n\n<b>Current prompt:</b>\n<code>${preview.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</code>\n\n<i>Send your new prompt as a message now.\nOr tap Reset to go back to default.</i>`,
            { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
                [{ text: '🔄 Reset to Default', callback_data: 'cmd_ai_prompt_reset' }],
                [{ text: '🔙 Back to Hub', callback_data: 'menu_main' }]
            ]}}
        ).catch(() => {});
        ctx.session = ctx.session || {};
        ctx.session.awaitingPrompt = true;
    });

    bot.action('cmd_ai_prompt_reset', async (ctx) => {
        ctx.answerCbQuery('Prompt reset.');
        try { await fsp.unlink(PROMPT_FILE); } catch { /* already gone */ }
        ctx.editMessageText('✅ <b>AI prompt reset to default.</b>', {
            parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Hub', callback_data: 'menu_main' }]] }
        }).catch(() => {});
    });

    // ==========================================
    // 👑 SUDO MANAGEMENT ──────────────────────────────────────────────────
    bot.action('menu_sudo', async (ctx) => {
        ctx.answerCbQuery();
        const owners = ownerManager.getOwners();
        const sudos  = ownerManager.getSudos();
        const ownerList = owners.length ? owners.map(j => `<code>${j}</code>`).join('\n') : 'None';
        const sudoList  = sudos.length  ? sudos.map(j  => `<code>${j}</code>`).join('\n') : 'None';
        const text = `👑 <b>OWNER & SUDO MANAGEMENT</b>\n\n🔑 <b>Owners:</b>\n${ownerList}\n\n🛡️ <b>Sudo Users:</b>\n${sudoList}`;
        const reply_markup = { inline_keyboard: [
            [{ text: '➕ Add Sudo', callback_data: 'sudo_add' }, { text: '➖ Remove Sudo', callback_data: 'sudo_remove' }],
            [{ text: '🔙 Back to Hub', callback_data: 'menu_main' }]
        ]};
        ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup }).catch(() => {});
    });

    bot.action('sudo_add', (ctx) => {
        ctx.answerCbQuery();
        ctx.session = ctx.session || {};
        ctx.session.sudoAction = 'add';
        ctx.editMessageText('🛡️ <b>ADD SUDO</b>\n\nSend the WhatsApp number to add as sudo:\n<i>Example: 2348012345678</i>', {
            parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Cancel', callback_data: 'menu_sudo' }]] }
        }).catch(() => {});
    });

    bot.action('sudo_remove', async (ctx) => {
        ctx.answerCbQuery();
        const sudos = ownerManager.getSudos();
        if (sudos.length === 0) return ctx.editMessageText('⚠️ No sudo users to remove.', {
            parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'menu_sudo' }]] }
        }).catch(() => {});
        const buttons = sudos.map(j => [{ text: `🗑️ ${j}`, callback_data: `sudo_rm_${j}` }]);
        buttons.push([{ text: '🔙 Cancel', callback_data: 'menu_sudo' }]);
        ctx.editMessageText('🛡️ <b>REMOVE SUDO</b>\n\nSelect a user to remove:', {
            parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons }
        }).catch(() => {});
    });

    bot.action(/^sudo_rm_(.+)$/, async (ctx) => {
        const jid = ctx.match[1];
        await ownerManager.removeSudo(jid);
        ctx.answerCbQuery(`Removed ${jid}`);
        const sudos = ownerManager.getSudos();
        const owners = ownerManager.getOwners();
        const ownerList = owners.length ? owners.map(j => `<code>${j}</code>`).join('\n') : 'None';
        const sudoList  = sudos.length  ? sudos.map(j  => `<code>${j}</code>`).join('\n') : 'None';
        ctx.editMessageText(`✅ Removed.\n\n👑 <b>Owners:</b>\n${ownerList}\n\n🛡️ <b>Sudo:</b>\n${sudoList}`, {
            parse_mode: 'HTML', reply_markup: { inline_keyboard: [
                [{ text: '➕ Add Sudo', callback_data: 'sudo_add' }, { text: '➖ Remove Sudo', callback_data: 'sudo_remove' }],
                [{ text: '🔙 Back to Hub', callback_data: 'menu_main' }]
            ]}
        }).catch(() => {});
    });

    // 🛠️ MAIN MENU ACTION HANDLERS (System Level)
    // ==========================================
    bot.action('cmd_ai_help', (ctx) => {
        ctx.answerCbQuery();
        ctx.editMessageText('🧠 <b>OMEGA AI ASSISTANT</b>\n\nThe AI is connected. To use it, simply type:\n\n<code>/ai [Your prompt here]</code>\n\nExample: <code>/ai Write a high-converting promotional message for my crypto group</code>', { 
            parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Hub', callback_data: 'menu_main' }]] }
        }).catch((e) => logger.warn('Telegram API call failed', { error: e.message }));
    });

    bot.action('cmd_wipequeue', async (ctx) => {
        ctx.answerCbQuery('Wiping Redis Database...');
        try {
            // Fix: broadcastQueue is now a static import at the top — no dynamic require
            ctx.editMessageText('🗑️ <b>WIPING REDIS DATABASE...</b>\n<i>Please wait...</i>', { parse_mode: 'HTML' }).catch((e) => logger.warn('editMessageText failed', { error: e.message }));
            await broadcastQueue.pause();
            await broadcastQueue.obliterate({ force: true });
            await broadcastQueue.resume();
            ctx.editMessageText('✅ <b>QUEUE DESTROYED</b>\nAll pending Godcasts and broadcasts have been completely wiped.', {
                parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Hub', callback_data: 'menu_main' }]] }
            }).catch((e) => logger.warn('editMessageText failed', { error: e.message }));
        } catch (err) {
            logger.error('[Telegram] cmd_wipequeue failed', { error: err.message });
            ctx.editMessageText(`❌ <b>ERROR:</b> ${err.message}`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Hub', callback_data: 'menu_main' }]] } }).catch((e) => logger.warn('editMessageText failed', { error: e.message }));
        }
    });

    bot.action('help_pair', (ctx) => {
        ctx.answerCbQuery();
        ctx.editMessageText('➕ <b>HOW TO DEPLOY A NEW NODE:</b>\n\nTo pair a new WhatsApp number, send the following command in this chat:\n\n<code>/pair [phone_number]</code>\n\n<i>Example:</i> <code>/pair 2348123456789</code>', { 
            parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Hub', callback_data: 'menu_main' }]] }
        }).catch((e) => logger.warn('Telegram API call failed', { error: e.message }));
    });

    bot.action('cmd_plugins', (ctx) => {
        ctx.answerCbQuery('Loading Command Book...');
        const categories = getDynamicPlugins();
        let menuText = `📚 <b>PAPPY DYNAMIC PLUGIN MENU</b>\n<i>Send these directly in Telegram to execute!</i>\n\n`;
        for (const [cat, cmds] of Object.entries(categories)) {
            menuText += `◈ <b>[ ${cat} ]</b>\n  └ <code>${cmds.join('</code>, <code>')}</code>\n\n`;
        }
        ctx.editMessageText(menuText, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Hub', callback_data: 'menu_main' }]] } }).catch((e) => logger.warn('Telegram API call failed', { error: e.message }));
    });

    bot.action('cmd_analytics', (ctx) => {
        ctx.answerCbQuery('Fetching Telemetry...');
        const sysUsed = Math.round((os.totalmem() - os.freemem()) / 1024 / 1024);
        const botRss = Math.round(process.memoryUsage().rss / 1024 / 1024); 
        const stats = taskManager.getStats();
        
        const dashboard = `📊 <b>ENGINE ANALYTICS</b>\n\n🟢 Nodes Online: ${activeSockets.size}\n⚡ Tasks Running: ${stats.running}\n⏳ Tasks Queued: ${stats.queued}\n🤖 Engine RAM: ${botRss}MB\n💻 Server RAM: ${sysUsed}MB`;
        
        ctx.editMessageText(dashboard, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Hub', callback_data: 'menu_main' }]] } }).catch((e) => logger.warn('Telegram API call failed', { error: e.message }));
    });

    bot.action('cmd_sleep', (ctx) => {
        ctx.answerCbQuery('System Sleeping...');
        botState.isSleeping = true;
        saveState();
        const { text, reply_markup } = getMainDashboardMenu();
        ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup }).catch((e) => logger.warn('Telegram API call failed', { error: e.message }));
    });

    bot.action('cmd_wake', (ctx) => {
        ctx.answerCbQuery('System Waking...');
        botState.isSleeping = false;
        saveState();
        const { text, reply_markup } = getMainDashboardMenu();
        ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup }).catch((e) => logger.warn('Telegram API call failed', { error: e.message }));
    });

    bot.action('cmd_restart', (ctx) => {
        ctx.answerCbQuery('Restarting System...');
        ctx.editMessageText('🔄 <b>RESTARTING ENGINE...</b>\n\n<i>The control panel will go offline for 5 seconds while the engine reboots.</i>', { parse_mode: 'HTML' }).catch((e) => logger.warn('Telegram API call failed', { error: e.message }));
        setTimeout(() => process.exit(0), 1500);
    });

    // ==========================================
    // 🔗 RESTORED NATIVE TELEGRAM COMMANDS
    // ==========================================
    bot.command('ai', async (ctx) => {
        if (!ai) return ctx.reply('AI is offline right now.');
        const prompt = ctx.message.text.replace('/ai', '').trim();
        if (!prompt) return ctx.reply('just ask me something\nexample: /ai what is 2+2');
        try {
            const response = await ai.generateText(prompt, ctx.from.id.toString());
            await ctx.reply(response);
        } catch (e) {
            await ctx.reply(`couldn't reach AI: ${e.message}`);
        }
    });

    bot.command('pair', async (ctx) => {
        const args  = ctx.message.text.split(' ');
        const tgId  = ctx.from.id.toString();
        if (args.length < 2) return ctx.reply('⚠️ <b>Usage:</b>\n<code>/pair [phone]</code>', { parse_mode: 'HTML' });

        // ─ Channel gate: must join @pappylung first
        try {
            const member = await bot.telegram.getChatMember('@pappylung', ctx.from.id);
            if (!['member','administrator','creator'].includes(member.status)) {
                return ctx.reply(
                    '🚨 <b>Join Required!</b>\n\nYou must join our channel before using this bot:\n\n👉 <a href="https://t.me/pappylung">@pappylung</a>\n\n<i>Join then try /pair again.</i>',
                    { parse_mode: 'HTML', disable_web_page_preview: false }
                );
            }
        } catch {
            // If channel check fails (private channel etc), allow through
        }

        // ─ One bot per user
        const pairingRegistry = require('../modules/pairingRegistry');
        if (tgId !== ownerTelegramId && pairingRegistry.hasBot(tgId)) {
            const existing = pairingRegistry.getPhone(tgId);
            return ctx.reply(
                `⚠️ <b>You already have a bot paired!</b>\n\n📱 Number: <code>+${existing}</code>\n\n<i>You can only pair one number. Use /rmsession to remove it first.</i>`,
                { parse_mode: 'HTML' }
            );
        }

        const phone = args[1].replace(/[^0-9]/g, '');
        ctx.reply(`⚙️ <b>INITIALIZING STEALTH LINK...</b>\n\n📱 <code>+${phone}</code>\n<i>Please wait for your pairing code...</i>`, { parse_mode: 'HTML' });
        try { await startWhatsApp(tgId, phone, args[2] || '1'); }
        catch (err) { ctx.reply(`❌ <b>ERROR:</b>\n<code>${err.message}</code>`, { parse_mode: 'HTML' }); }
    });

    bot.command('status', async (ctx) => {
        const text = ctx.message.text.replace('/status', '').trim();
        if (!text) return ctx.reply('❌ Provide text for the status.');
        if (activeSockets.size === 0) return ctx.reply('❌ No WhatsApp accounts connected.');

        ctx.reply('📱 <b>UPLOADING STATUS...</b>', { parse_mode: 'HTML' });
        let successCount = 0;
        
        for (const [key, sock] of activeSockets.entries()) {
            if (!sock?.user) continue;
            try {
                const groups = await sock.groupFetchAllParticipating();
                await sock.sendMessage("status@broadcast", { text: `Ω ELITE BROADCAST\n\n${text}` }, { statusJidList: Object.keys(groups) });
                successCount++;
            } catch (e) { logger.warn('Status upload failed for node', { error: e.message }); }
        }
        ctx.reply(`✅ <b>STATUS UPLOADED</b>\nSuccessfully posted on ${successCount} account(s).`, { parse_mode: 'HTML' });
    });

    bot.command('rmsession', async (ctx) => {
        const phone = ctx.message.text.split(' ')[1];
        if (!phone) return ctx.reply('❌ Usage: <code>/rmsession 2348123456789</code>', { parse_mode: 'HTML' });
        let targetKey = null;
        for (const key of activeSockets.keys()) {
            if (key.includes(phone)) targetKey = key;
        }

        if (!targetKey) return ctx.reply(`❌ Could not find an active session for +${phone}.`, { parse_mode: 'HTML' });
        const sock = activeSockets.get(targetKey);
        if (sock) {
            try { sock.logout(); } catch (e) { sock.ws.close(); }
            activeSockets.delete(targetKey);
        }

        const sessionDir = path.join(SESSIONS_PATH, path.basename(targetKey));
        try { await fsp.rm(sessionDir, { recursive: true, force: true }); } catch (e) { logger.warn('Failed to rm session dir', { error: e.message }); }
      
        ctx.reply(`🗑️ <b>SESSION DESTROYED</b>\nThe account +${phone} has been completely removed.`, { parse_mode: 'HTML' });
    });

    bot.command('dm', async (ctx) => {
        const args = ctx.message.text.split(' ');
        if (args.length < 3) return ctx.reply('❌ Usage: /dm 2348123456789 Your Message');
        const targetPhone = args[1].replace(/[^0-9]/g, '');
        const message = args.slice(2).join(' ');
        const targetJid = `${targetPhone}@s.whatsapp.net`;

        const firstSocket = Array.from(activeSockets.values()).find(sock => sock?.user);
        if (!firstSocket) return ctx.reply('❌ No active sockets.');

        try {
            await firstSocket.sendMessage(targetJid, { text: message });
            ctx.reply(`✅ <b>DM SENT to +${targetPhone}</b>`, { parse_mode: 'HTML' });
        } catch (e) {
            ctx.reply(`❌ <b>FAILED:</b> ${e.message}`, { parse_mode: 'HTML' });
        }
    });

    bot.command('castmedia', async (ctx) => {
        if (!ctx.message.photo && !ctx.message.video) return ctx.reply('❌ Send a Photo/Video with /castmedia caption.');
        const firstSocket = Array.from(activeSockets.values()).find(sock => sock?.user);
        if (!firstSocket) return ctx.reply('❌ No connected WhatsApp nodes.');

        ctx.reply('🚀 <b>DOWNLOADING MEDIA & DISPATCHING TO JITTER QUEUE...</b>', { parse_mode: 'HTML' });

        try {
            const fileId = ctx.message.photo ? ctx.message.photo[ctx.message.photo.length - 1].file_id : ctx.message.video.file_id;
            const fileUrl = await ctx.telegram.getFileLink(fileId);
            const response = await axios.get(fileUrl.href, { responseType: 'arraybuffer' });
            const mediaBuffer = Buffer.from(response.data, 'binary');
            const caption = ctx.message.caption ? ctx.message.caption.replace('/castmedia', '').trim() : '';
            const isPhoto = !!ctx.message.photo;
            
            taskManager.submit(`TG_MEDIA_${Date.now()}`, async (abortSignal) => {
                const groups = await firstSocket.groupFetchAllParticipating();
                const jids = Object.keys(groups);
                for (let i = 0; i < jids.length; i++) {
                    if (abortSignal.aborted) break;
                    await firstSocket.sendMessage(jids[i], { [isPhoto ? 'image' : 'video']: mediaBuffer, caption: caption }).catch((e) => logger.warn('Telegram API call failed', { error: e.message }));
                    
                    // 🛡️ HUMAN EMULATION: Wait between 2.5 and 4.5 seconds
                    await new Promise(res => setTimeout(res, 2500 + Math.random() * 2000));
                }
            }, { priority: 2, timeout: 600000 });

            ctx.reply(`✅ <b>MEDIA BROADCAST QUEUED</b>`, { parse_mode: 'HTML' });
        } catch (err) {
            ctx.reply(`❌ <b>FAILED:</b> ${err.message}`, { parse_mode: 'HTML' });
        }
    });

    bot.command('osint', async (ctx) => {
        const text = ctx.message.reply_to_message?.text || ctx.message.text.replace('/osint', '').trim();
        if (!text) return ctx.reply('❌ *Syntax:* Reply to a message with `/osint` or paste text after the command.', { parse_mode: 'Markdown' });

        const waitMsg = await ctx.reply('🕵️‍♂️ <b>ANALYZING TEXT FOR WHATSAPP INTELLIGENCE...</b>', { parse_mode: 'HTML' });

        try {
            const regex = /chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/ig;
            let match;
            let addedCount = 0;
            let duplicates = 0;
            
            while ((match = regex.exec(text)) !== null) {
                const code = match[1];
                try {
                    const result = await Intel.updateOne({ linkCode: code }, { $setOnInsert: { linkCode: code, status: 'pending' } }, { upsert: true });
                    if (result.upsertedCount > 0) addedCount++;
                    else duplicates++;
                } catch (e) { duplicates++; }
            }

            if (addedCount > 0) {
                await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, `✅ <b>OSINT SUCCESS</b>\n\nExtracted and securely saved <b>${addedCount}</b> new WhatsApp links to the database. (Skipped ${duplicates} duplicates).`, { parse_mode: 'HTML' });
            } else {
                await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, `⚠️ <b>NO NEW LINKS</b>\nFound ${duplicates} links, but they were already safely secured in the database.`, { parse_mode: 'HTML' });
            }
        } catch (err) {
            await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, `❌ <b>ERROR:</b> ${err.message}`, { parse_mode: 'HTML' });
        }
    });

    bot.command('gcast', async (ctx) => {
        const text = ctx.message.text.replace('/gcast', '').trim();
        if (!text) return ctx.reply('❌ Syntax: <code>/gcast Message</code>', { parse_mode: 'HTML' });
        const firstActiveSocket = Array.from(activeSockets.values()).find(sock => sock?.user);
        if (!firstActiveSocket) return ctx.reply('❌ <b>No active WhatsApp nodes.</b>', { parse_mode: 'HTML' });
        const botId = firstActiveSocket.user.id.split(':')[0];
        // broadcastQueue is statically imported at the top of this file
        const raw = await firstActiveSocket.groupFetchAllParticipating().catch(() => ({}));
        const jids = Object.values(raw).filter(g => g.participants.length >= 5).map(g => ({ id: g.id, size: g.participants.length }));
        const jobs = jids.map(group => ({ name: `GCAST_${botId}_${group.id}`, data: { botId, targetJid: group.id, textContent: text, mode: 'normal', useGhostProtocol: false }, opts: { priority: 3, removeOnComplete: true } }));
        for (let i = 0; i < jobs.length; i += 500) await broadcastQueue.addBulk(jobs.slice(i, i + 500));
        ctx.reply(`🌸 *ENGINE ENGAGED:* ${jids.length} drops queued.`, { parse_mode: 'HTML' });
    });

    bot.command('godcast', async (ctx) => {
        const text = ctx.message.text.replace('/godcast', '').trim();
        if (!text) return ctx.reply('❌ Syntax: <code>/godcast Message</code>', { parse_mode: 'HTML' });
        const firstActiveSocket = Array.from(activeSockets.values()).find(sock => sock?.user);
        if (!firstActiveSocket) return ctx.reply('❌ <b>No active WhatsApp nodes.</b>', { parse_mode: 'HTML' });
        const botId = firstActiveSocket.user.id.split(':')[0];
        const raw = await firstActiveSocket.groupFetchAllParticipating().catch(() => ({}));
        const jids = Object.values(raw).filter(g => g.participants.length >= 5).map(g => ({ id: g.id, size: g.participants.length }));
        const jobs = jids.map(group => ({ name: `GODCAST_${botId}_${group.id}`, data: { botId, targetJid: group.id, textContent: text, mode: 'advanced_status', font: 3, backgroundColor: '#FFB7C5', useGhostProtocol: true }, opts: { priority: 1, removeOnComplete: true } }));
        for (let i = 0; i < jobs.length; i += 500) await broadcastQueue.addBulk(jobs.slice(i, i + 500));
        ctx.reply(`🌸 *ENGINE ENGAGED:* ${jids.length} drops queued.`, { parse_mode: 'HTML' });
    });

    bot.command('wipequeue', async (ctx) => {
        try {
            ctx.reply('🗑️ <b>WIPING REDIS DATABASE...</b>\n<i>Please wait...</i>', { parse_mode: 'HTML' });
            await broadcastQueue.pause();
            await broadcastQueue.obliterate({ force: true });
            await broadcastQueue.resume();
            ctx.reply('✅ <b>QUEUE DESTROYED</b>\nAll pending Godcasts and broadcasts have been completely wiped from the Redis Cloud.', { parse_mode: 'HTML' });
        } catch (err) {
            ctx.reply(`❌ <b>ERROR:</b> ${err.message}`, { parse_mode: 'HTML' });
        }
    });

    bot.command('updategstatus', async (ctx) => {
        const text = ctx.message.text.replace('/updategstatus', '').trim();
        if (!text) return ctx.reply('❌ Usage: <code>/updategstatus Your text</code>', { parse_mode: 'HTML' });

        const sock = Array.from(activeSockets.values()).find(s => s?.user);
        if (!sock) return ctx.reply('❌ No active WhatsApp nodes.');

        const gs = gsPlugin;
        if (!gs) return ctx.reply('❌ Group Status plugin not loaded.');

        ctx.reply('📡 <b>Posting group status...</b>', { parse_mode: 'HTML' });

        const mockMsg = {
            key: { remoteJid: sock.user.id.split(':')[0] + '@s.whatsapp.net', fromMe: true, id: `TG_GS_${Date.now()}` },
            message: { conversation: `.updategstatus ${text}` }
        };
        const mockUser = { role: 'owner', stats: { commandsUsed: 0 }, activity: { isBanned: false } };
        
        const bridgeSock = new Proxy(sock, {
            get(target, prop) {
                if (prop === 'sendMessage') {
                    return async (jid, payload, ...rest) => {
                        if (payload.text) ctx.reply(`📱 <b>STATUS:</b>\n${payload.text}`, { parse_mode: 'HTML' });
                        else return target.sendMessage(jid, payload, ...rest);
                    };
                }
                return target[prop];
            }
        });

        // 🧠 SaaS Fix: Aligned with the Router destructuring
        taskManager.submit(`TG_GS_${Date.now()}`, async (abortSignal) => {
            await gs.execute({ sock: bridgeSock, msg: mockMsg, args: text.split(' '), text: `.updategstatus ${text}`, user: mockUser, botId: sock.user.id.split(':')[0], abortSignal });
        }, { priority: 5, timeout: 120000 }).catch(err => ctx.reply(`❌ ${err.message}`));
    });

    // ==========================================
    // 🌉 UNIVERSAL TELEGRAM-TO-WHATSAPP BRIDGE
    // ==========================================
    bot.on('text', async (ctx, next) => {
        const text = ctx.message.text;

        // Handle awaiting prompt input
        if (ctx.session?.awaitingPrompt) {
            ctx.session.awaitingPrompt = false;
            if (text.length < 10) return ctx.reply('Prompt too short, try again.');
            await saveCustomPrompt(text);
            return ctx.reply('✅ <b>AI prompt updated!</b>\nThe bot will use your new prompt from now on.', {
                parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Hub', callback_data: 'menu_main' }]] }
            });
        }

        // Handle GC Entry Drop text
        if (ctx.session?.state === 'AWAITING_WARMUP_CONTENT') {
            const sessionKey = ctx.session.warmupNode;
            ctx.session.state = 'IDLE';
            ctx.session.warmupNode = null;
            const phone = sessionKey?.split('_')[1] || sessionKey;
            const cfgPath = require('path').join(__dirname, '../data', `warmup-config-${phone}.json`);
            const existing = require('fs').existsSync(cfgPath) ? JSON.parse(require('fs').readFileSync(cfgPath, 'utf8')) : {};
            existing.statusPayload = text; existing.mediaType = null;
            require('fs').writeFileSync(cfgPath, JSON.stringify(existing, null, 2));
            const confirmMsg = await ctx.reply(`✅ <b>Saved!</b> GC Entry Drop set for +${phone}.`, { parse_mode: 'HTML' });
            setTimeout(async () => {
                await ctx.telegram.deleteMessage(ctx.chat.id, confirmMsg.message_id).catch(() => {});
                const sock = activeSockets.get(sessionKey);
                const isOnline = sock?.user ? 'Online 🟢' : 'Offline ⏳';
                ctx.reply(`📱 <b>NODE CONTROL: +${phone}</b>\n\n<b>Status:</b> ${isOnline}`, {
                    parse_mode: 'HTML', reply_markup: { inline_keyboard: [
                        [{ text: '🔄 Restart Node', callback_data: `restart_node_${sessionKey}` }, { text: '🗑️ Purge Node', callback_data: `purge_node_${sessionKey}` }],
                        [{ text: '📡 Broadcast & Godcast', callback_data: `bcast_node_${sessionKey}` }],
                        [{ text: '🎯 Nexus Sniper', callback_data: `nexus_node_${sessionKey}` }],
                        [{ text: '💬 Send DM', callback_data: `dm_node_${sessionKey}` }, { text: '🖼️ Upload Status', callback_data: `status_node_${sessionKey}` }],
                        [{ text: '📸 Group Status (Config)', callback_data: `gstatus_node_${sessionKey}` }],
                        [{ text: '🔥 Set GC Entry Drop', callback_data: `warmup_set_${sessionKey}` }],
                        [{ text: '🔗 Join Intel GCs', callback_data: `intel_join_${sessionKey}` }],
                        [{ text: '📤 Send All Intel Links', callback_data: `intel_send_${sessionKey}` }, { text: '🗑️ Clear Intel DB', callback_data: `intel_clear_${sessionKey}` }],
                        [{ text: '🔙 Back to Nodes', callback_data: 'menu_nodes' }]
                    ]}
                }).catch(() => {});
            }, 1500);
            return;
        }

        // Handle sudo add input
        if (ctx.session?.sudoAction === 'add') {
            ctx.session.sudoAction = null;
            const phone = text.replace(/[^0-9]/g, '');
            if (!phone) return ctx.reply('❌ Invalid number.');
            const jid = `${phone}@s.whatsapp.net`;
            await ownerManager.addSudo(jid);
            return ctx.reply(`✅ <b>Added sudo:</b> <code>${jid}</code>`, {
                parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '👑 Back to Sudo Menu', callback_data: 'menu_sudo' }]] }
            });
        }

        // Handle Set GC Status input
        if (ctx.session?.gcStatusNode) {
            const sessionKey = ctx.session.gcStatusNode;
            ctx.session.gcStatusNode = null;
            const sock = activeSockets.get(sessionKey);
            if (!sock?.user) return ctx.reply('❌ Node is offline.');
            const gsPlugin = (() => { try { return require('../plugins/pappy-groupstatus'); } catch { return null; } })();
            if (!gsPlugin) return ctx.reply('❌ Group status plugin not loaded.');
            ctx.reply('⏳ <b>Posting GC status...</b>', { parse_mode: 'HTML' });
            const mockMsg = { key: { remoteJid: sock.user.id.split(':')[0] + '@s.whatsapp.net', fromMe: true, id: `TG_GS_${Date.now()}` }, message: { conversation: `.updategstatus ${text}` } };
            const mockUser = { role: 'owner', stats: { commandsUsed: 0 }, activity: { isBanned: false } };
            const botId = sock.user.id.split(':')[0];
            taskManager.submit(`TG_GS_${Date.now()}`, async (abortSignal) => {
                await gsPlugin.execute({ sock, msg: mockMsg, args: text.split(' '), text: `.updategstatus ${text}`, user: mockUser, botId, abortSignal });
            }, { priority: 5, timeout: 120000 }).then(() => ctx.reply('✅ <b>GC Status posted!</b>', { parse_mode: 'HTML' })).catch(err => ctx.reply(`❌ ${err.message}`));
            return;
        }

        // Auto-feed WhatsApp links from Telegram to intel autojoin queue
        if (text.includes('chat.whatsapp.com')) {
            try {
                const { default: intelPlugin } = await Promise.resolve().then(() => ({ default: require('../plugins/pappy-intel') }));
                const links = text.match(/chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/ig);
                if (links?.length) {
                    // Emit as a fake message.upsert event so intel daemon picks it up
                    const eventBus = require('./eventBus');
                    eventBus.emit('message.upsert', { text });
                    ctx.reply(`📡 <b>${links.length} link(s) queued for auto-join</b>`, { parse_mode: 'HTML' }).catch(() => {});
                }
            } catch {}
        }

        if (!text.startsWith('.')) return next();

        const args = text.trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        const firstActiveSocket = Array.from(activeSockets.values()).find(sock => sock?.user);
        if (!firstActiveSocket) return ctx.reply('❌ <b>No active WhatsApp nodes.</b> Deploy a node first using /pair.', { parse_mode: 'HTML' });

        // Fix: use static PLUGIN_REGISTRY — eliminates dynamic require(variable) in bridge
        const targetPlugin = PLUGIN_REGISTRY.get(commandName) || null;

        if (!targetPlugin) return ctx.reply(`❌ Unknown WhatsApp command: <code>${commandName}</code>`, { parse_mode: 'HTML' });

        const botId = firstActiveSocket.user.id.split(':')[0];
        const botJid = `${botId}@s.whatsapp.net`;
        const mockMsg = {
            key: { remoteJid: botJid, fromMe: false, id: `TG_CMD_${Date.now()}` },
            message: { conversation: text },
            pushName: 'Telegram'
        };
        const mockUserProfile = { role: 'owner', name: 'Telegram', stats: { commandsUsed: 0 }, activity: { isBanned: false } };

        // Broadcast commands — use real socket, no bridge proxy to avoid spam
        const broadcastCmds = new Set(['.godcast', '.gcast', '.schedulecast', '.schedulegodcast', '.loopcast', '.loopgodcast', '.stopcast']);
        if (broadcastCmds.has(commandName)) {
            const statusMsg = await ctx.reply('🚀 <b>Broadcast starting...</b>', { parse_mode: 'HTML' });

            // Store TG context globally so broadcast can update it
            global._tgBroadcastCtx = { chatId: ctx.chat.id, msgId: statusMsg.message_id };

            const broadcastMsg = {
                key: { remoteJid: botJid, fromMe: false, id: `TG_BCAST_${Date.now()}` },
                message: { conversation: text },
                pushName: 'Telegram'
            };
            taskManager.submit(`TG_EXEC_${Date.now()}`, async (abortSignal) => {
                await targetPlugin.execute({ sock: firstActiveSocket, msg: broadcastMsg, args: text.trim().split(/ +/).slice(1), text, user: mockUserProfile, botId, abortSignal });
            }, { priority: 5, timeout: 600000 }).catch(err => {
                ctx.reply(`❌ <b>Plugin Error:</b> ${err.message}`, { parse_mode: 'HTML' });
                global._tgBroadcastCtx = null;
            });
            return;
        }

        // 🪞 Proxy socket to redirect WhatsApp responses back to Telegram
        // Text-only intermediate messages (searching, please wait, errors) are suppressed
        // Audio/video/image payloads are forwarded directly
        const bridgeSock = new Proxy(firstActiveSocket, {
            get(target, prop) {
                if (prop === 'sendMessage') {
                    return async (jid, payload, ...rest) => {
                        try {
                            if (payload.audio) {
                                return ctx.replyWithAudio({ source: Buffer.isBuffer(payload.audio) ? payload.audio : Buffer.from(payload.audio) }, {
                                    title: payload.contextInfo?.externalAdReply?.title || '',
                                    performer: payload.contextInfo?.externalAdReply?.body || '',
                                });
                            } else if (payload.image) {
                                const caption = (payload.caption || '').slice(0, 1024);
                                return ctx.replyWithPhoto({ source: Buffer.isBuffer(payload.image) ? payload.image : Buffer.from(payload.image) }, { caption });
                            } else if (payload.video) {
                                const caption = (payload.caption || '').slice(0, 1024);
                                return ctx.replyWithVideo({ source: Buffer.isBuffer(payload.video) ? payload.video : Buffer.from(payload.video) }, { caption });
                            } else if (payload.text) {
                                const t = payload.text;
                                // Only send short single-line responses, suppress broadcast progress/status spam
                                const isNoise = t.includes('Please wait') || t.includes('Searching') ||
                                    t.includes('Processing') || t.includes('scanning') ||
                                    t.includes('ENGINE ENGAGED') || t.includes('GODCAST') ||
                                    t.includes('GCAST') || t.includes('STARTED') ||
                                    t.includes('COMPLETE') || t.includes('IN PROGRESS') ||
                                    t.includes('drops') || t.includes('Sent:') ||
                                    t.split('\n').length > 6;
                                if (!isNoise) {
                                    return ctx.reply(`📱 <b>NODE FEEDBACK:</b>\n${t}`, { parse_mode: 'HTML' });
                                }
                            }
                        } catch { /* ignore bridge send errors */ }
                    };
                }
                return target[prop];
            }
        });

        // 🧠 SaaS Fix: Route through our standard object destructuring pattern
        taskManager.submit(`TG_EXEC_${Date.now()}`, async (abortSignal) => {
             await targetPlugin.execute({ sock: bridgeSock, msg: mockMsg, args, text, user: mockUserProfile, botId, abortSignal });
        }, { priority: 5, timeout: 60000 }).catch(err => ctx.reply(`❌ <b>Plugin Error:</b> ${err.message}`, { parse_mode: 'HTML' }));
    });

    bot.launch().then(() => { logger.system('Premium Telegram Dashboard is ONLINE.'); });

    // ── WARMUP: photo sent while awaiting GC entry drop ──
    bot.on('photo', async (ctx) => {
        if (ctx.session?.state !== 'AWAITING_WARMUP_CONTENT') return;
        const sessionKey = ctx.session.warmupNode;
        ctx.session.state = 'IDLE';
        ctx.session.warmupNode = null;
        const phone = sessionKey?.split('_')[1] || sessionKey;
        try {
            const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
            const fileUrl = await ctx.telegram.getFileLink(fileId);
            const res = await require('axios').get(fileUrl.href, { responseType: 'arraybuffer' });
            const mediaPath = require('path').join(__dirname, `../data/warmup-media-${phone}.jpg`);
            require('fs').writeFileSync(mediaPath, Buffer.from(res.data));
            const caption = ctx.message.caption || '';
            const cfgPath = require('path').join(__dirname, `../data/warmup-config-${phone}.json`);
            const cfg = require('fs').existsSync(cfgPath) ? JSON.parse(require('fs').readFileSync(cfgPath, 'utf8')) : {};
            cfg.statusPayload = caption; cfg.mediaType = 'image';
            require('fs').writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
            const confirmMsg = await ctx.reply(`✅ <b>Saved!</b> Image entry drop set for +${phone}.`, { parse_mode: 'HTML' });
            setTimeout(async () => {
                await ctx.telegram.deleteMessage(ctx.chat.id, confirmMsg.message_id).catch(() => {});
                const sock = activeSockets.get(sessionKey);
                const isOnline = sock?.user ? 'Online 🟢' : 'Offline ⏳';
                ctx.reply(`📱 <b>NODE CONTROL: +${phone}</b>\n\n<b>Status:</b> ${isOnline}`, {
                    parse_mode: 'HTML', reply_markup: { inline_keyboard: [
                        [{ text: '🔄 Restart Node', callback_data: `restart_node_${sessionKey}` }, { text: '🗑️ Purge Node', callback_data: `purge_node_${sessionKey}` }],
                        [{ text: '📡 Broadcast & Godcast', callback_data: `bcast_node_${sessionKey}` }],
                        [{ text: '🎯 Nexus Sniper', callback_data: `nexus_node_${sessionKey}` }],
                        [{ text: '💬 Send DM', callback_data: `dm_node_${sessionKey}` }, { text: '🖼️ Upload Status', callback_data: `status_node_${sessionKey}` }],
                        [{ text: '📸 Group Status (Config)', callback_data: `gstatus_node_${sessionKey}` }],
                        [{ text: '🔥 Set GC Entry Drop', callback_data: `warmup_set_${sessionKey}` }],
                        [{ text: '🔗 Join Intel GCs', callback_data: `intel_join_${sessionKey}` }],
                        [{ text: '📤 Send All Intel Links', callback_data: `intel_send_${sessionKey}` }, { text: '🗑️ Clear Intel DB', callback_data: `intel_clear_${sessionKey}` }],
                        [{ text: '🔙 Back to Nodes', callback_data: 'menu_nodes' }]
                    ]}
                }).catch(() => {});
            }, 1500);
        } catch (e) { ctx.reply(`❌ Failed: ${e.message}`); }
    });

    // ── WARMUP: video sent while awaiting GC entry drop ──
    bot.on('video', async (ctx) => {
        if (ctx.session?.state !== 'AWAITING_WARMUP_CONTENT') return;
        const sessionKey = ctx.session.warmupNode;
        ctx.session.state = 'IDLE';
        ctx.session.warmupNode = null;
        const phone = sessionKey?.split('_')[1] || sessionKey;
        try {
            const fileId = ctx.message.video.file_id;
            const fileUrl = await ctx.telegram.getFileLink(fileId);
            const res = await require('axios').get(fileUrl.href, { responseType: 'arraybuffer' });
            const mediaPath = require('path').join(__dirname, `../data/warmup-media-${phone}.mp4`);
            require('fs').writeFileSync(mediaPath, Buffer.from(res.data));
            const caption = ctx.message.caption || '';
            const cfgPath = require('path').join(__dirname, `../data/warmup-config-${phone}.json`);
            const cfg = require('fs').existsSync(cfgPath) ? JSON.parse(require('fs').readFileSync(cfgPath, 'utf8')) : {};
            cfg.statusPayload = caption; cfg.mediaType = 'video';
            require('fs').writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
            const confirmMsg = await ctx.reply(`✅ <b>Saved!</b> Video entry drop set for +${phone}.`, { parse_mode: 'HTML' });
            setTimeout(async () => {
                await ctx.telegram.deleteMessage(ctx.chat.id, confirmMsg.message_id).catch(() => {});
                const sock = activeSockets.get(sessionKey);
                const isOnline = sock?.user ? 'Online 🟢' : 'Offline ⏳';
                ctx.reply(`📱 <b>NODE CONTROL: +${phone}</b>\n\n<b>Status:</b> ${isOnline}`, {
                    parse_mode: 'HTML', reply_markup: { inline_keyboard: [
                        [{ text: '🔄 Restart Node', callback_data: `restart_node_${sessionKey}` }, { text: '🗑️ Purge Node', callback_data: `purge_node_${sessionKey}` }],
                        [{ text: '📡 Broadcast & Godcast', callback_data: `bcast_node_${sessionKey}` }],
                        [{ text: '🎯 Nexus Sniper', callback_data: `nexus_node_${sessionKey}` }],
                        [{ text: '💬 Send DM', callback_data: `dm_node_${sessionKey}` }, { text: '🖼️ Upload Status', callback_data: `status_node_${sessionKey}` }],
                        [{ text: '📸 Group Status (Config)', callback_data: `gstatus_node_${sessionKey}` }],
                        [{ text: '🔥 Set GC Entry Drop', callback_data: `warmup_set_${sessionKey}` }],
                        [{ text: '🔗 Join Intel GCs', callback_data: `intel_join_${sessionKey}` }],
                        [{ text: '📤 Send All Intel Links', callback_data: `intel_send_${sessionKey}` }, { text: '🗑️ Clear Intel DB', callback_data: `intel_clear_${sessionKey}` }],
                        [{ text: '🔙 Back to Nodes', callback_data: 'menu_nodes' }]
                    ]}
                }).catch(() => {});
            }, 1500);
        } catch (e) { ctx.reply(`❌ Failed: ${e.message}`); }
    });

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));

    return bot;
}

module.exports = { startTelegram, getMainDashboardMenu };
