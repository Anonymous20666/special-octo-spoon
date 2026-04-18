'use strict';
// plugins/pappy-admin.js — Aggressive Group Protection Suite

const fsp    = require('fs').promises;
const path   = require('path');
const logger = require('../core/logger');
const eventBus = require('../core/eventBus');

const DB_PATH = path.join(__dirname, '../data/group_settings.json');

// ─── DB ──────────────────────────────────────────────────────────────────────
let _db = {};
let _writePending = false;

async function loadDb() {
    try { _db = JSON.parse(await fsp.readFile(DB_PATH, 'utf8')); } catch { _db = {}; }
}

async function saveDb() {
    if (_writePending) return;
    _writePending = true;
    try { await fsp.writeFile(DB_PATH, JSON.stringify(_db, null, 2), 'utf8'); }
    catch (e) { logger.error('[Admin] DB save failed', { error: e.message }); }
    finally { _writePending = false; }
}

function getGroup(jid) {
    if (!_db[jid]) _db[jid] = {
        antilink: false, antibot: false, antigm: false,
        antispam: false, antichannel: false,
        antilinkAction: 'kick', antibotAction: 'kick',
        antigmAction: 'kick', antispamAction: 'warn',
        antichannelAction: 'kick',
        warns: {}, spamTracker: {},
        maxWarns: 3,
    };
    return _db[jid];
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
async function kickUser(sock, jid, userJid) {
    await sock.groupParticipantsUpdate(jid, [userJid], 'remove');
}

async function warnUser(sock, jid, userJid, reason, group) {
    if (!group.warns[userJid]) group.warns[userJid] = 0;
    group.warns[userJid]++;
    await saveDb();
    const count = group.warns[userJid];
    const max   = group.maxWarns || 3;
    await sock.sendMessage(jid, {
        text: `⚠️ @${userJid.split('@')[0]} has been warned.\n📌 Reason: ${reason}\n🔢 Warns: ${count}/${max}`,
        mentions: [userJid]
    });
    if (count >= max) {
        group.warns[userJid] = 0;
        await saveDb();
        await sock.sendMessage(jid, { text: `🚫 @${userJid.split('@')[0]} reached max warns. Kicking...`, mentions: [userJid] });
        await kickUser(sock, jid, userJid).catch(() => {});
    }
}

async function deleteMsg(sock, msg) {
    await sock.sendMessage(msg.key.remoteJid, { delete: msg.key }).catch(() => {});
}

async function takeAction(sock, jid, userJid, action, reason, group, msg) {
    if (action === 'kick') {
        await deleteMsg(sock, msg).catch(() => {});
        await sock.sendMessage(jid, { text: `🚫 @${userJid.split('@')[0]} was kicked.\n📌 Reason: ${reason}`, mentions: [userJid] });
        await kickUser(sock, jid, userJid).catch(() => {});
    } else if (action === 'warn') {
        await deleteMsg(sock, msg).catch(() => {});
        await warnUser(sock, jid, userJid, reason, group);
    } else if (action === 'delete') {
        await deleteMsg(sock, msg).catch(() => {});
        await sock.sendMessage(jid, { text: `🗑️ Message deleted.\n📌 Reason: ${reason}` });
    }
}

loadDb().catch(() => {});

// ─── PROTECTION DAEMON ───────────────────────────────────────────────────────
let daemonStarted = false;
function startDaemon() {
    if (daemonStarted) return;
    daemonStarted = true;

    eventBus.on('message.upsert', async ({ sock, msg, text, isGroup, sender, botId }) => {
        if (!isGroup || !msg?.message) return;
        const jid   = msg.key.remoteJid;
        const group = getGroup(jid);

        // Skip bot's own messages and admins
        if (msg.key.fromMe) return;
        try {
            const meta  = await sock.groupMetadata(jid);
            const me    = `${botId}@s.whatsapp.net`;
            const isAdmin = meta.participants.find(p => p.id === sender)?.admin;
            const botIsAdmin = meta.participants.find(p => p.id === me)?.admin;
            if (isAdmin || !botIsAdmin) return; // skip admins & if bot not admin
        } catch { return; }

        // ── ANTILINK ──────────────────────────────────────────────────────────
        if (group.antilink) {
            const hasLink = /https?:\/\/|chat\.whatsapp\.com|t\.me\/|bit\.ly|tinyurl/i.test(text || '');
            if (hasLink) {
                await takeAction(sock, jid, sender, group.antilinkAction, 'Sending links is not allowed', group, msg);
                return;
            }
        }

        // ── ANTICHANNEL ───────────────────────────────────────────────────────
        if (group.antichannel) {
            const isChannel = msg.key.participant?.includes('newsletter') ||
                msg.message?.extendedTextMessage?.contextInfo?.forwardingScore > 5;
            if (isChannel) {
                await takeAction(sock, jid, sender, group.antichannelAction, 'Channel messages not allowed', group, msg);
                return;
            }
        }

        // ── ANTIBOT ───────────────────────────────────────────────────────────
        if (group.antibot) {
            const isBot = sender.includes(':') || sender.includes('bot');
            if (isBot) {
                await takeAction(sock, jid, sender, group.antibotAction, 'Bots are not allowed in this group', group, msg);
                return;
            }
        }

        // ── ANTIGM (anti-group-mention / mass tag) ────────────────────────────
        if (group.antigm) {
            const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
            if (mentions.length >= 5) {
                await takeAction(sock, jid, sender, group.antigmAction, 'Mass tagging is not allowed', group, msg);
                return;
            }
        }

        // ── ANTISPAM ──────────────────────────────────────────────────────────
        if (group.antispam) {
            const now = Date.now();
            if (!group.spamTracker[sender]) group.spamTracker[sender] = [];
            group.spamTracker[sender] = group.spamTracker[sender].filter(t => now - t < 5000);
            group.spamTracker[sender].push(now);
            if (group.spamTracker[sender].length >= 5) {
                group.spamTracker[sender] = [];
                await takeAction(sock, jid, sender, group.antispamAction, 'Spamming is not allowed', group, msg);
                return;
            }
        }
    });
}

// ─── MODULE ──────────────────────────────────────────────────────────────────
module.exports = {
    category: 'ADMIN',
    commands: [
        // Protection toggles
        { cmd: '.antilink',    role: 'admin' },
        { cmd: '.antibot',     role: 'admin' },
        { cmd: '.antigm',      role: 'admin' },
        { cmd: '.antispam',    role: 'admin' },
        { cmd: '.antichannel', role: 'admin' },
        // Action setters
        { cmd: '.setaction',   role: 'admin' },
        // Moderation
        { cmd: '.kick',        role: 'admin' },
        { cmd: '.warn',        role: 'admin' },
        { cmd: '.warns',       role: 'admin' },
        { cmd: '.resetwarn',   role: 'admin' },
        { cmd: '.delete',      role: 'admin' },
        { cmd: '.deleteall',   role: 'admin' },
        { cmd: '.ban',         role: 'admin' },
        { cmd: '.unban',       role: 'admin' },
        { cmd: '.promote',     role: 'admin' },
        { cmd: '.demote',      role: 'admin' },
        { cmd: '.mute',        role: 'admin' },
        { cmd: '.unmute',      role: 'admin' },
        { cmd: '.groupsettings', role: 'admin' },
        { cmd: '.setgrppfp',   role: 'admin' },
        { cmd: '.tagall',      role: 'admin' },
        { cmd: '.hidetag',     role: 'admin' },
        { cmd: '.setmypfp',    role: 'owner' },
        { cmd: '.delpfp',      role: 'owner' },
        { cmd: '.fullpfp',     role: 'public' },
    ],

    init: () => { startDaemon(); },

    execute: async ({ sock, msg, args, text, user, botId }) => {
        const jid   = msg.key.remoteJid;
        const cmd   = text.split(' ')[0].toLowerCase();
        const group = getGroup(jid);

        // Get mentioned user
        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
            || (args[0] ? `${args[0].replace(/[^0-9]/g, '')}@s.whatsapp.net` : null);

        // ── PROTECTION TOGGLES ────────────────────────────────────────────────
        const toggleMap = {
            '.antilink': 'antilink', '.antibot': 'antibot',
            '.antigm': 'antigm', '.antispam': 'antispam', '.antichannel': 'antichannel'
        };

        if (toggleMap[cmd]) {
            const key    = toggleMap[cmd];
            const action = args[0]?.toLowerCase();
            if (action === 'on' || action === 'off') {
                group[key] = action === 'on';
                await saveDb();
                return sock.sendMessage(jid, {
                    text: `${group[key] ? '✅' : '🔴'} *${cmd.slice(1).toUpperCase()}* is now *${action.toUpperCase()}*\n⚙️ Action: *${group[key + 'Action'] || 'kick'}*`
                }, { quoted: msg });
            }
            return sock.sendMessage(jid, {
                text: `⚙️ *${cmd.slice(1).toUpperCase()}* Status: ${group[key] ? '✅ ON' : '🔴 OFF'}\nAction: *${group[key + 'Action'] || 'kick'}*\n\nUsage: ${cmd} on/off`
            }, { quoted: msg });
        }

        // ── SET ACTION ────────────────────────────────────────────────────────
        if (cmd === '.setaction') {
            // .setaction antilink kick|warn|delete
            const feature = args[0]?.toLowerCase();
            const action  = args[1]?.toLowerCase();
            const validFeatures = ['antilink', 'antibot', 'antigm', 'antispam', 'antichannel'];
            const validActions  = ['kick', 'warn', 'delete'];
            if (!validFeatures.includes(feature) || !validActions.includes(action)) {
                return sock.sendMessage(jid, { text: '❌ Usage: .setaction <antilink|antibot|antigm|antispam|antichannel> <kick|warn|delete>' }, { quoted: msg });
            }
            group[feature + 'Action'] = action;
            await saveDb();
            return sock.sendMessage(jid, { text: `✅ *${feature}* action set to *${action}*` }, { quoted: msg });
        }

        // ── KICK ──────────────────────────────────────────────────────────────
        if (cmd === '.kick' || cmd === '.ban') {
            if (!mentioned) return sock.sendMessage(jid, { text: '❌ Tag or mention a user to kick.' }, { quoted: msg });
            await sock.sendMessage(jid, { text: `🚫 @${mentioned.split('@')[0]} has been removed.`, mentions: [mentioned] });
            await kickUser(sock, jid, mentioned).catch(() => {});
            return;
        }

        // ── WARN ──────────────────────────────────────────────────────────────
        if (cmd === '.warn') {
            if (!mentioned) return sock.sendMessage(jid, { text: '❌ Tag a user to warn.' }, { quoted: msg });
            const reason = args.slice(1).join(' ') || 'No reason given';
            await warnUser(sock, jid, mentioned, reason, group);
            return;
        }

        // ── WARNS ─────────────────────────────────────────────────────────────
        if (cmd === '.warns') {
            if (!mentioned) {
                const list = Object.entries(group.warns || {})
                    .filter(([, v]) => v > 0)
                    .map(([k, v]) => `• @${k.split('@')[0]}: ${v}/${group.maxWarns || 3} warns`)
                    .join('\n') || 'No active warns.';
                return sock.sendMessage(jid, { text: `📋 *WARN LIST*\n\n${list}` }, { quoted: msg });
            }
            const count = group.warns?.[mentioned] || 0;
            return sock.sendMessage(jid, {
                text: `⚠️ @${mentioned.split('@')[0]} has *${count}/${group.maxWarns || 3}* warns.`,
                mentions: [mentioned]
            }, { quoted: msg });
        }

        // ── RESET WARN ────────────────────────────────────────────────────────
        if (cmd === '.resetwarn') {
            if (!mentioned) return sock.sendMessage(jid, { text: '❌ Tag a user to reset warns.' }, { quoted: msg });
            group.warns[mentioned] = 0;
            await saveDb();
            return sock.sendMessage(jid, { text: `✅ Warns reset for @${mentioned.split('@')[0]}`, mentions: [mentioned] }, { quoted: msg });
        }

        // ── DELETE ────────────────────────────────────────────────────────────
        if (cmd === '.delete') {
            const quoted = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
            if (!quoted) return sock.sendMessage(jid, { text: '❌ Reply to a message to delete it.' }, { quoted: msg });
            const quotedKey = {
                remoteJid: jid,
                id: quoted,
                participant: msg.message?.extendedTextMessage?.contextInfo?.participant,
                fromMe: false,
            };
            await sock.sendMessage(jid, { delete: quotedKey }).catch(() => {});
            return;
        }

        // ── DELETE ALL (delete all msgs from a tagged user) ───────────────────
        if (cmd === '.deleteall') {
            if (!mentioned) return sock.sendMessage(jid, { text: '❌ Tag a user to delete all their messages.' }, { quoted: msg });
            await sock.sendMessage(jid, { text: `🗑️ Deleting all messages from @${mentioned.split('@')[0]}...`, mentions: [mentioned] });

            // Fetch cached messages and delete ones from this user
            let deleted = 0;
            if (global.messageCache) {
                for (const [id, cachedMsg] of global.messageCache.entries()) {
                    const msgSender = cachedMsg.key?.participant || cachedMsg.key?.remoteJid;
                    if (cachedMsg.key?.remoteJid === jid && msgSender === mentioned) {
                        await sock.sendMessage(jid, { delete: cachedMsg.key }).catch(() => {});
                        global.messageCache.delete(id);
                        deleted++;
                        await new Promise(r => setTimeout(r, 300));
                    }
                }
            }
            return sock.sendMessage(jid, { text: `✅ Deleted *${deleted}* message(s) from @${mentioned.split('@')[0]}`, mentions: [mentioned] }, { quoted: msg });
        }

        // ── PROMOTE / DEMOTE ──────────────────────────────────────────────────
        if (cmd === '.promote') {
            if (!mentioned) return sock.sendMessage(jid, { text: '❌ Tag a user to promote.' }, { quoted: msg });
            await sock.groupParticipantsUpdate(jid, [mentioned], 'promote');
            return sock.sendMessage(jid, { text: `⬆️ @${mentioned.split('@')[0]} promoted to admin.`, mentions: [mentioned] }, { quoted: msg });
        }

        if (cmd === '.demote') {
            if (!mentioned) return sock.sendMessage(jid, { text: '❌ Tag a user to demote.' }, { quoted: msg });
            await sock.groupParticipantsUpdate(jid, [mentioned], 'demote');
            return sock.sendMessage(jid, { text: `⬇️ @${mentioned.split('@')[0]} demoted from admin.`, mentions: [mentioned] }, { quoted: msg });
        }

        // ── MUTE / UNMUTE ─────────────────────────────────────────────────────
        if (cmd === '.mute') {
            await sock.groupSettingUpdate(jid, 'announcement');
            return sock.sendMessage(jid, { text: '🔇 Group muted. Only admins can send messages.' }, { quoted: msg });
        }

        if (cmd === '.unmute') {
            await sock.groupSettingUpdate(jid, 'not_announcement');
            return sock.sendMessage(jid, { text: '🔊 Group unmuted. Everyone can send messages.' }, { quoted: msg });
        }

        // ── UNBAN ─────────────────────────────────────────────────────────────
        if (cmd === '.unban') {
            if (!mentioned) return sock.sendMessage(jid, { text: '❌ Tag a user to unban/add back.' }, { quoted: msg });
            await sock.groupParticipantsUpdate(jid, [mentioned], 'add');
            return sock.sendMessage(jid, { text: `✅ @${mentioned.split('@')[0]} has been added back.`, mentions: [mentioned] }, { quoted: msg });
        }

        // ── GROUP SETTINGS ────────────────────────────────────────────────────
        if (cmd === '.groupsettings') {
            const g = group;
            return sock.sendMessage(jid, {
                text: `⚙️ *GROUP PROTECTION SETTINGS*\n\n` +
                    `🔗 Antilink: ${g.antilink ? '✅' : '🔴'} [${g.antilinkAction}]\n` +
                    `🤖 Antibot: ${g.antibot ? '✅' : '🔴'} [${g.antibotAction}]\n` +
                    `📢 Anti-GM: ${g.antigm ? '✅' : '🔴'} [${g.antigmAction}]\n` +
                    `💬 Antispam: ${g.antispam ? '✅' : '🔴'} [${g.antispamAction}]\n` +
                    `📡 Antichannel: ${g.antichannel ? '✅' : '🔴'} [${g.antichannelAction}]\n` +
                    `⚠️ Max Warns: ${g.maxWarns || 3}\n\n` +
                    `_Use .setaction <feature> <kick|warn|delete> to change actions_`
            }, { quoted: msg });
        }

        // ── SET GROUP PFP (admin) ─────────────────────────────────────────────
        if (cmd === '.setgrppfp') {
            const quotedImg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage
                || msg.message?.imageMessage;
            if (!quotedImg) return sock.sendMessage(jid, { text: '❌ Reply to or send an image to set as group photo.' }, { quoted: msg });
            try {
                const { downloadMediaMessage } = require('@whiskeysockets/baileys');
                const imgMsg = msg.message?.imageMessage
                    ? msg
                    : { key: msg.key, message: msg.message?.extendedTextMessage?.contextInfo?.quotedMessage };
                const buffer = await downloadMediaMessage(imgMsg, 'buffer', {}, { logger: null, reuploadRequest: sock.updateMediaMessage });
                await sock.updateProfilePicture(jid, buffer);
                return sock.sendMessage(jid, { text: '✅ Group photo updated!' }, { quoted: msg });
            } catch (e) {
                return sock.sendMessage(jid, { text: `❌ Failed: ${e.message}` }, { quoted: msg });
            }
        }

        // ── TAGALL — tag all members (hidden style) ──────────────────────────────────────────
        if (cmd === '.tagall') {
            try {
                const meta = await sock.groupMetadata(jid);
                const members = meta.participants.map(p => p.id);
                const message = args.join(' ') || '📢 *Group Announcement*';
                return sock.sendMessage(jid, {
                    text: message,
                    mentions: members
                });
            } catch (e) {
                if (e.message.includes('rate-overlimit')) {
                    return sock.sendMessage(jid, { text: '⏳ *Rate Limited*\nWait 30 seconds before using this command again.' });
                }
                return sock.sendMessage(jid, { text: `❌ Failed: ${e.message}` });
            }
        }

        // ── HIDETAG — tag all members without showing tags ────────────────────
        if (cmd === '.hidetag') {
            try {
                const meta = await sock.groupMetadata(jid);
                const members = meta.participants.map(p => p.id);
                const message = args.join(' ') || '📢 *Hidden Tag Message*';
                return sock.sendMessage(jid, {
                    text: message,
                    mentions: members
                });
            } catch (e) {
                if (e.message.includes('rate-overlimit')) {
                    return sock.sendMessage(jid, { text: '⏳ *Rate Limited*\nWait 30 seconds before using this command again.' });
                }
                return sock.sendMessage(jid, { text: `❌ Failed: ${e.message}` });
            }
        }

        // ── SET BOT ACC PFP (owner only) ──────────────────────────────────────
        if (cmd === '.setmypfp') {
            const quotedImg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage
                || msg.message?.imageMessage;
            if (!quotedImg) return sock.sendMessage(jid, { text: '❌ Reply to or send an image to set as bot profile photo.' }, { quoted: msg });
            try {
                const { downloadMediaMessage } = require('gifted-baileys');
                const imgMsg = msg.message?.imageMessage
                    ? msg
                    : { key: msg.key, message: msg.message?.extendedTextMessage?.contextInfo?.quotedMessage };
                const buffer = await downloadMediaMessage(imgMsg, 'buffer', {}, { logger: null, reuploadRequest: sock.updateMediaMessage });
                // Set on bot's own JID
                const botJid = `${botId}@s.whatsapp.net`;
                await sock.updateProfilePicture(botJid, buffer);
                return sock.sendMessage(jid, { text: '✅ Bot profile photo updated!' }, { quoted: msg });
            } catch (e) {
                return sock.sendMessage(jid, { text: `❌ Failed: ${e.message}` }, { quoted: msg });
            }
        }

        // ── DELETE PFP (owner only) ───────────────────────────────────────────
        if (cmd === '.delpfp') {
            try {
                const target = mentioned || `${botId}@s.whatsapp.net`;
                await sock.removeProfilePicture(target);
                return sock.sendMessage(jid, { text: '✅ Profile photo removed.' }, { quoted: msg });
            } catch (e) {
                return sock.sendMessage(jid, { text: `❌ Failed: ${e.message}` }, { quoted: msg });
            }
        }

        // ── FULL PFP — fetch full uncropped profile picture ───────────────────
        if (cmd === '.fullpfp') {
            const target = mentioned
                || msg.message?.extendedTextMessage?.contextInfo?.participant
                || msg.key.remoteJid;
            try {
                const ppUrl = await sock.profilePictureUrl(target, 'image');
                const axios = require('axios');
                const res   = await axios.get(ppUrl, { responseType: 'arraybuffer', timeout: 10000 });
                const buffer = Buffer.from(res.data);
                const name = target.split('@')[0];
                return sock.sendMessage(jid, {
                    image:   buffer,
                    caption: `🖼️ *Full Profile Picture*\n📱 +${name}`,
                    // jpegThumbnail not set — sends full uncropped image
                }, { quoted: msg });
            } catch (e) {
                return sock.sendMessage(jid, { text: `❌ Could not fetch profile picture.\n${e.message}` }, { quoted: msg });
            }
        }
    }
};
