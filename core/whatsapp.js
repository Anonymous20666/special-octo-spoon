'use strict';
// core/whatsapp.js — Connection Manager

const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    DisconnectReason,
    delay,
    Browsers,
    downloadMediaMessage,
} = require('gifted-baileys');
const pino      = require('pino');
const NodeCache = require('node-cache');
const fs        = require('fs');
const fsp       = require('fs').promises;
const path      = require('path');

const { ownerTelegramId } = require('../config');
const ownerManager = require('../modules/ownerManager');
const jidMapper    = require('../modules/jidMapper');
const logger              = require('./logger');
const engine              = require('./engine');
const ai                  = require('./ai');
const musicPlugin         = require('../plugins/pappy-music');
const { safeJsonParse }   = require('../utils/validator');
const { backupSession }   = require('../services/sessionBackup');

const SESSIONS_PATH = path.join(__dirname, '../data/sessions');
const STATE_FILE    = path.join(__dirname, '../data/botState.json');

const activeSockets = new Map();
global.waSocks = activeSockets;

if (!global.messageCache) global.messageCache = new Map();
if (!global._aiReplyCache) global._aiReplyCache = new Map();

// User devices cache — prevents repeated device queries
const _userDevicesCache = new NodeCache({ stdTTL: 1800, useClones: false });

// Suppress noisy session logs
const suppressedPatterns = [
    /Closing session/i, /Closing open session/i, /Removing old closed session/i,
    /Decrypted message with closed session/i, /in favor of incoming/i, /prekey bundle/i,
    /SessionEntry/i, /failed to decrypt/i, /Bad MAC/i, /Session error/i,
];
const originalConsoleError = console.error;
console.error = (...args) => {
    const str = args.map(a => String(a ?? '')).join(' ');
    if (suppressedPatterns.some(p => p.test(str))) return;
    if (args.some(a => a && typeof a === 'object' && (a._chains || a.indexInfo || a.currentRatchet))) return;
    originalConsoleError.apply(console, args);
};

// Cache the WA version once — no network call on every reconnect
let _cachedWaVersion = null;
async function getWaVersion() {
    if (_cachedWaVersion) return _cachedWaVersion;
    try {
        const { version } = await fetchLatestBaileysVersion();
        if (version) { _cachedWaVersion = version; return version; }
    } catch { /* ignore */ }
    return [2, 3000, 1017531287];
}

// Group metadata cache — avoid fetching on every message
const _groupMetaCache = new Map(); // jid → { meta, ts }
async function getGroupAdmin(sock, jid, sender) {
    const now = Date.now();
    const cached = _groupMetaCache.get(jid);
    if (cached && now - cached.ts < 300000) {
        const p = cached.meta.find(p => p.id === sender);
        return p?.admin === 'admin' || p?.admin === 'superadmin';
    }
    try {
        const meta = await sock.groupMetadata(jid);
        _groupMetaCache.set(jid, { meta: meta.participants, ts: now });
        const p = meta.participants.find(p => p.id === sender);
        return p?.admin === 'admin' || p?.admin === 'superadmin';
    } catch {
        return false;
    }
}

// ─── STATE (async read/write) ───────────────────────────────────────────────
let botState = { isSleeping: false, pappyMode: {} }; // pappyMode: { [groupJid]: true/false }
let _stateWritePending = false;

async function loadState() {
    try {
        const raw    = await fsp.readFile(STATE_FILE, 'utf-8');
        const parsed = safeJsonParse(raw, { isSleeping: false, pappyMode: {} });
        botState = { pappyMode: {}, ...parsed }; // ensure pappyMode always exists
    } catch {
        botState = { isSleeping: false, pappyMode: {} };
    }
}

// Fix: serialised async write — prevents concurrent writes to the same file
// (javascript-file-race-bad)
async function saveState() {
    if (_stateWritePending) return;
    _stateWritePending = true;
    try {
        await fsp.mkdir(path.dirname(STATE_FILE), { recursive: true });
        await fsp.writeFile(STATE_FILE, JSON.stringify(botState), 'utf-8');
    } catch (err) {
        logger.error('Failed to save bot state', { error: err.message });
    } finally {
        _stateWritePending = false;
    }
}

// Initialise state on module load (non-blocking)
loadState().catch(() => {});

// Ensure sessions dir exists
fs.mkdirSync(SESSIONS_PATH, { recursive: true });
fs.mkdirSync(path.join(__dirname, '../data'), { recursive: true });

// ─── MAIN CONNECTION FUNCTION ─────────────────────────────────────────────────
async function startWhatsApp(chatId = ownerTelegramId, phoneNumber, slotId = '1', isRestart = false, retryCount = 0) {
    if (botState.isSleeping && !isRestart) return;

    const sessionKey = `${chatId}_${phoneNumber}_${slotId}`;
    if (activeSockets.has(sessionKey) && !isRestart) return;

    const sessionDir = path.join(SESSIONS_PATH, sessionKey);
    await fsp.mkdir(sessionDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const version = await getWaVersion();

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        markOnlineOnConnect: true,
        userDevicesCache: _userDevicesCache,
        shouldSyncHistoryMessage: () => false,
        keepAliveIntervalMs: 20000,
        connectTimeoutMs: 15000,
        defaultQueryTimeoutMs: 20000,
        retryRequestDelayMs: 50,
        maxMsgRetryCount: 2,
        getMessage: async () => undefined,
        patchMessageBeforeSending: (message) => {
            const requiresPatch = !!(message.buttonsMessage || message.templateMessage || message.listMessage);
            if (requiresPatch) {
                message = {
                    viewOnceMessage: {
                        message: {
                            messageContextInfo: { deviceListMetadataVersion: 2, deviceListMetadata: {} },
                            ...message,
                        },
                    },
                };
            }
            return message;
        },
    });

    // ─── PAIRING CODE ────────────────────────────────────────────────────────
    if (!sock.authState.creds.registered) {
        logger.system(`Initiating pairing sequence for +${phoneNumber}...`);
        let pairRetries = 0;

        const requestPairing = async () => {
            try {
                const cleanNumber = String(phoneNumber).replace(/[^0-9]/g, '');
                await delay(4000);
                const code = await sock.requestPairingCode(cleanNumber);
                const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                logger.system(`PAIRING CODE FOR +${cleanNumber}: ${formattedCode}`);

                if (global.tgBot) {
                    await global.tgBot.telegram.sendMessage(
                        chatId,
                        `🔗 <b>PAIRING CODE FOR +${cleanNumber}</b>\n\n<code>${formattedCode}</code>\n\n<i>Enter this in WhatsApp › Linked Devices › Link with phone number.</i>`,
                        { parse_mode: 'HTML' }
                    ).catch((e) => logger.error('Failed to send pairing code to Telegram', { error: e.message }));
                }
            } catch (err) {
                logger.error(`Pairing code error: ${err.message}`, { error: err.message });
                pairRetries++;
                if (pairRetries < 3) {
                    setTimeout(requestPairing, 5000);
                } else if (global.tgBot) {
                    global.tgBot.telegram
                        .sendMessage(chatId, `❌ <b>PAIRING FAILED</b>\nError: <code>${err.message}</code>`, { parse_mode: 'HTML' })
                        .catch((e) => logger.error('Failed to send pairing failure to Telegram', { error: e.message }));
                }
            }
        };

        setTimeout(requestPairing, 3000);
    }

    activeSockets.set(sessionKey, sock);
    sock.ev.on('creds.update', async () => {
        await saveCreds();
        // Backup session to S3 on every creds update
        backupSession(sessionKey).catch(() => {});
    });

    // Learn @lid -> real JID mappings from WhatsApp contact sync
    sock.ev.on('contacts.upsert', async (contacts) => {
        for (const c of contacts) {
            if (c.lid && c.id && !c.id.includes('@lid')) {
                await jidMapper.register(c.lid, c.id).catch(() => {});
            }
        }
    });


    // ─── CONNECTION EVENTS ───────────────────────────────────────────────────
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const statusCode     = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut
                && statusCode !== DisconnectReason.badSession
                && statusCode !== DisconnectReason.connectionReplaced;

            activeSockets.delete(sessionKey);

            if (shouldReconnect) {
                const isServerRestart = statusCode === DisconnectReason.restartRequired || statusCode === 428;
                const nextRetry       = isServerRestart ? 0 : retryCount + 1;
                const reconnectDelay  = isServerRestart ? 3000 : Math.min(5000 * Math.pow(2, retryCount), 300000);

                logger.system(`Connection closed (Code: ${statusCode}). Reconnecting ${sessionKey} in ${reconnectDelay}ms...`);
                setTimeout(() => startWhatsApp(chatId, phoneNumber, slotId, true, nextRetry), reconnectDelay);
            } else {
                // ── LOGGED OUT — purge local + S3, no reconnect, ever ──
                logger.system(`LOGGED OUT: ${sessionKey}. Purging local + S3...`);
                activeSockets.delete(sessionKey);

                // Detach watchdog so it stops trying to restart this dead session
                const watchdog = require('./watchdog');
                watchdog.detach(phoneNumber);

                // 1. Delete local session folder
                await fsp.rm(path.join(SESSIONS_PATH, sessionKey), { recursive: true, force: true })
                    .catch(err => logger.error('Failed to purge local session', { error: err.message }));

                // 2. Delete from LocalStack / S3 so it never gets restored on restart
                const { deleteBackup } = require('../services/sessionBackup');
                await deleteBackup(sessionKey).catch(() => {});

                // 3. Remove from pairing registry so the user can pair again
                const pairingReg = require('../modules/pairingRegistry');
                await pairingReg.unregister(chatId).catch(() => {});

                // 4. Remove from owner.json so the number loses owner access
                const ownerMgr = require('../modules/ownerManager');
                const purgedJid = `${phoneNumber}@s.whatsapp.net`;
                ownerMgr.getOwners().includes(purgedJid) && await ownerMgr.removeOwner(purgedJid).catch(() => {});

                // 5. Delete from MongoDB so DB stays clean
                try {
                    const User = require('../core/models/User');
                    await User.deleteOne({ userId: purgedJid });
                    logger.info(`[Purge] Removed ${purgedJid} from MongoDB`);
                } catch (e) { logger.warn(`[Purge] MongoDB cleanup failed: ${e.message}`); }

                logger.success(`Session ${sessionKey} fully purged.`);

                if (global.tgBot) {
                    global.tgBot.telegram
                        .sendMessage(chatId,
                            `🗑️ <b>NODE LOGGED OUT & DELETED</b>\n\n📱 +${phoneNumber} was logged out of WhatsApp.\n\nThe session has been fully removed. Use /pair to link again if needed.`,
                            { parse_mode: 'HTML' })
                        .catch(() => {});
                }
            }
        }

const pairingRegistry = require('../modules/pairingRegistry');

        if (connection === 'open') {
            retryCount = 0;
            logger.success(`WhatsApp Online → ${phoneNumber}`);
            await ownerManager.registerPairedNumber(phoneNumber);

            // Notify only on FIRST pair (not restarts)
            if (!isRestart && global.tgBot) {
                await pairingRegistry.register(chatId, phoneNumber);
                global.tgBot.telegram.sendMessage(
                    chatId,
                    `✅ <b>NODE PAIRED SUCCESSFULLY!</b>\n\n` +
                    `📱 Number: <code>+${phoneNumber}</code>\n` +
                    `🔗 Status: <b>Online & Ready</b>\n\n` +
                    `<i>Your bot is now active. Use /start to manage it.</i>`,
                    { parse_mode: 'HTML' }
                ).catch(() => {});
            }

            engine.triggerBoot(sock);
        }
    });

    // ─── MESSAGE ROUTING ─────────────────────────────────────────────────────
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (botState.isSleeping || (type !== 'notify' && type !== 'append')) return;

        const msg = messages[0];
        if (!msg?.message) return;

        if (msg.key?.id) global.messageCache.set(msg.key.id, msg);

        const jid        = msg.key.remoteJid;
        const isGroup    = jid.endsWith('@g.us');
        const botId      = sock.user?.id?.split(':')[0] || phoneNumber;
        const fullBotJid = `${botId}@s.whatsapp.net`;

        let text = msg.message.conversation
            || msg.message.extendedTextMessage?.text
            || msg.message.imageMessage?.caption
            || msg.message.videoMessage?.caption
            || '';

        if (msg.message.ephemeralMessage) {
            const eph = msg.message.ephemeralMessage.message;
            text = eph?.conversation || eph?.extendedTextMessage?.text || eph?.imageMessage?.caption || eph?.videoMessage?.caption || '';
        }

        const rawSender = msg.key.fromMe ? fullBotJid : (msg.key.participant || msg.key.remoteJid);
        // Allow self messages and private messages
        // if (msg.key.fromMe) return;  // REMOVED - allow bot to respond to itself
        // if (!isGroup) return;        // REMOVED - allow private messages

        let sender = jidMapper.resolve(rawSender);
        let isGroupAdmin = false;

        // Use cached metadata — only fetch from WA if cache is stale/missing
        const cached = _groupMetaCache.get(jid);
        if (cached && Date.now() - cached.ts < 300000) {
            await jidMapper.learnFromGroup(cached.meta);
            sender = jidMapper.resolve(rawSender);
            const participant = cached.meta.find(p => p.id === sender || p.lid === rawSender);
            isGroupAdmin = !!participant?.admin;
        } else {
            try {
                const meta = await sock.groupMetadata(jid);
                _groupMetaCache.set(jid, { meta: meta.participants, ts: Date.now() });
                await jidMapper.learnFromGroup(meta.participants);
                sender = jidMapper.resolve(rawSender);
                const participant = meta.participants.find(p => p.id === sender || p.lid === rawSender);
                isGroupAdmin = !!participant?.admin;
            } catch { /* proceed without admin info */ }
        }


        // ─── AI — only fires when .pappy on is active for this group ────────────────────
        const ctxInfo           = msg.message?.extendedTextMessage?.contextInfo;
        const mentionedJids     = ctxInfo?.mentionedJid || [];
        const isMentioned       = mentionedJids.some(j => j.startsWith(botId));
        const quotedParticipant = ctxInfo?.participant;
        const quotedStanzaId    = ctxInfo?.stanzaId;
        const cachedMsg         = quotedStanzaId ? global.messageCache.get(quotedStanzaId) : null;
        const isReplyToBot      = !!(quotedParticipant?.startsWith(botId)) || !!(cachedMsg?.key?.fromMe);
        const hasImage          = !!(msg.message?.imageMessage);
        const hasVoice          = !!(msg.message?.audioMessage);
        const pappyOn           = botState.pappyMode?.[jid] === true;

        if (pappyOn && (isMentioned || isReplyToBot) && !text.startsWith('.')) {
            const lastReply = global._aiReplyCache.get(sender) || 0;
            if (Date.now() - lastReply < 3000) return;
            global._aiReplyCache.set(sender, Date.now());

            // Show typing indicator while AI processes
            sock.sendPresenceUpdate('composing', jid).catch(() => {});

            try {
                let response = '';

                if (hasImage) {
                    const imgBuffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: null, reuploadRequest: sock.updateMediaMessage });
                    const prompt = text.replace(/@\d+/g, '').trim() || 'Describe this image';
                    response = await ai.analyzeImage(imgBuffer, prompt, sender);
                } else if (hasVoice) {
                    const audioBuffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: null, reuploadRequest: sock.updateMediaMessage });
                    response = await ai.analyzeVoice(audioBuffer, sender);
                } else if (text) {
                    const cleanPrompt = text.replace(/@\d+/g, '').trim();
                    if (!cleanPrompt) return;
                    response = await ai.generateText(cleanPrompt, sender);
                } else return;

                if (response.startsWith('PLAY:')) {
                    await musicPlugin.execute({ sock, msg, args: response.slice(5).trim().split(' '), text: `.play ${response.slice(5).trim()}`, user: { name: 'AI' }, botId });
                    return;
                }
                if (response.startsWith('GENERATE_IMAGE:')) {
                    try { await sock.sendMessage(jid, { image: await ai.generateImage(response.slice(15).trim()), caption: '' }, { quoted: msg }); }
                    catch { await sock.sendMessage(jid, { text: "Couldn't generate that image." }, { quoted: msg }); }
                    return;
                }
                if (response.startsWith('SPEAK:')) {
                    try { await sock.sendMessage(jid, { audio: await ai.textToSpeech(response.slice(6).trim()), mimetype: 'audio/mpeg', ptt: true }, { quoted: msg }); }
                    catch { await sock.sendMessage(jid, { text: response.slice(6).trim() }, { quoted: msg }); }
                    return;
                }
                if (response.startsWith('SEARCH_VIDEO:')) {
                    try {
                        const { buffer, title } = await ai.searchVideo(response.slice(13).trim());
                        await sock.sendMessage(jid, { video: buffer, caption: title, mimetype: 'video/mp4' }, { quoted: msg });
                    } catch { await sock.sendMessage(jid, { text: `Couldn't find that video.` }, { quoted: msg }); }
                    return;
                }

                await sock.sendMessage(jid, { text: response }, { quoted: msg });

            } catch (err) {
                logger.warn(`[AI] Failed: ${err.message}`);
                await sock.sendMessage(jid, { text: 'Something went wrong, try again.' }, { quoted: msg }).catch(() => {});
            }
            return;
        }

        engine.triggerMessage({ sock, msg, text, isGroup, sender, botId, isGroupAdmin });
    });


    return sock;
}

module.exports = { startWhatsApp, activeSockets, loadState, saveState, botState, setPappyMode };

function setPappyMode(jid, value) {
    if (!botState.pappyMode) botState.pappyMode = {};
    botState.pappyMode[jid] = value;
    return saveState();
}
