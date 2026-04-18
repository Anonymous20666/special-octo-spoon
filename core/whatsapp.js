// core/whatsapp.js
// Ω ELITE CONNECTION MANAGER & EVENT-DRIVEN PROTOCOL

const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore, 
    DisconnectReason,
    delay,
    Browsers
} = require('gifted-baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const { ownerTelegramId, globalPrefix } = require('../config');
const logger = require('./logger');
const engine = require('./engine'); 

const SESSIONS_PATH = path.join(__dirname, '../data/sessions');
const STATE_FILE = path.join(__dirname, '../data/botState.json');

const activeSockets = new Map();
// 🧠 SaaS Fix: Expose this globally so bullEngine.js can find the sockets!
global.waSocks = activeSockets; 

let botState = { isSleeping: false, pappyMode: {} };
if (!global.messageCache) global.messageCache = new Map();
if (!global._aiReplyCache) global._aiReplyCache = new Map();
if (!global.stickerCache) global.stickerCache = new Map(); // Cache generated stickers

const STICKER_CACHE_DIR = path.join(__dirname, '../data/sticker_cache');
if (!fs.existsSync(STICKER_CACHE_DIR)) fs.mkdirSync(STICKER_CACHE_DIR, { recursive: true });

if (!fs.existsSync(SESSIONS_PATH)) fs.mkdirSync(SESSIONS_PATH, { recursive: true });
if (!fs.existsSync(path.join(__dirname, '../data'))) fs.mkdirSync(path.join(__dirname, '../data'));

const loadState = () => { 
    if (fs.existsSync(STATE_FILE)) {
        try { 
            const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
            botState = { pappyMode: {}, ...parsed };
        } 
        catch (e) { botState = { isSleeping: false, pappyMode: {} }; }
    }
};
const saveState = () => fs.writeFileSync(STATE_FILE, JSON.stringify(botState));
loadState();

/**
 * Initializes and manages a WhatsApp connection node.
 */
async function startWhatsApp(chatId = ownerTelegramId, phoneNumber, slotId = '1', isRestart = false, retryCount = 0) {
    if (botState.isSleeping && !isRestart) return;

    const sessionKey = `${chatId}_${phoneNumber}_${slotId}`;
    if (activeSockets.has(sessionKey) && !isRestart) return;

    const sessionDir = path.join(SESSIONS_PATH, sessionKey);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    let { version } = await fetchLatestBaileysVersion();
    if (!version) version = [2, 3000, 1017531287];

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        }, 
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'), 
        
        // 🛑 CONNECTION STABILITY OPTIMIZATIONS 🛑
        syncFullHistory: false, 
        generateHighQualityLinkPreview: false, 
        markOnlineOnConnect: false, 
        keepAliveIntervalMs: 20000, 
        connectTimeoutMs: 60000,    
        retryRequestDelayMs: 3000,  
        
        getMessage: async (key) => undefined,
        patchMessageBeforeSending: (message) => {
            const requiresPatch = !!(message.buttonsMessage || message.templateMessage || message.listMessage);
            if (requiresPatch) { 
                message = { viewOnceMessage: { message: { messageContextInfo: { deviceListMetadataVersion: 2, deviceListMetadata: {} }, ...message } } };
            }
            return message;
        }
    });

    // ─── PAIRING CODE GENERATION ───
    if (!sock.authState.creds.registered) {
        logger.system(`Initiating pairing sequence for +${phoneNumber}...`);
        let pairRetries = 0;

        const requestPairing = async () => {
            try {
                let cleanNumber = String(phoneNumber).replace(/[^0-9]/g, '');
                await delay(4000); 
                
                const code = await sock.requestPairingCode(cleanNumber);
                const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                
                logger.system(`PAIRING CODE FOR +${cleanNumber}: ${formattedCode}`);
                
                if (global.tgBot) {
                    try {
                        await global.tgBot.telegram.sendMessage(
                            chatId, 
                            `🔗 <b>PAIRING CODE FOR +${cleanNumber}</b>\n\n<code>${formattedCode}</code>\n\n<i>Enter this code in your WhatsApp > Linked Devices > Link with phone number instead.</i>`, 
                            { parse_mode: 'HTML' }
                        );
                    } catch (tgError) {
                        logger.error(`Failed to send pairing code to Telegram: ${tgError.message}`);
                    }
                }
            } catch (err) {
                logger.error(`Pairing code error: ${err.message}`);
                pairRetries++;
                if (pairRetries < 3) {
                    setTimeout(requestPairing, 5000);
                } else if (global.tgBot) {
                    try {
                        global.tgBot.telegram.sendMessage(chatId, `❌ <b>PAIRING FAILED</b>\nEnsure the number is correct. \nError: <code>${err.message}</code>`, { parse_mode: 'HTML' });
                    } catch (e) {}
                }
            }
        };
        setTimeout(requestPairing, 3000);
    }

    activeSockets.set(sessionKey, sock);
    sock.ev.on('creds.update', saveCreds);

    // ─── CONNECTION HANDLING ───
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
            activeSockets.delete(sessionKey); 
            
            if (shouldReconnect) {
                // 🧠 SaaS Fix: Exponential backoff for reconnections to prevent infinite loop crashes
                let reconnectDelay = Math.min(5000 * Math.pow(1.5, retryCount), 60000); 
                if (statusCode === DisconnectReason.restartRequired) reconnectDelay = 2000;
                
                logger.system(`Connection closed (Code: ${statusCode}). Reconnecting ${sessionKey} in ${reconnectDelay}ms...`);
                setTimeout(() => startWhatsApp(chatId, phoneNumber, slotId, true, retryCount + 1), reconnectDelay);
            } else {
                logger.system(`🚨 LOGGED OUT of session ${sessionKey}. Engaging Auto-Purge...`);
                const sessionDir = path.join(SESSIONS_PATH, sessionKey);
                if (fs.existsSync(sessionDir)) {
                    try { fs.rmSync(sessionDir, { recursive: true, force: true }); } 
                    catch (err) { logger.error('Failed to auto-purge session:', err); }
                }
                if (global.tgBot) {
                    try {
                        global.tgBot.telegram.sendMessage(chatId, `🗑️ <b>SESSION PURGED</b>\nNode +${phoneNumber} was logged out and has been permanently deleted.`, { parse_mode: 'HTML' }).catch(()=>{});
                    } catch (e) {}
                }
            }
        }
        
        if (connection === 'open') {
            logger.success(`🟩 WhatsApp Online → ${phoneNumber}`);
            engine.triggerBoot(sock); 
        }
    });

    // ─── MESSAGE EVENT ROUTING ───
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (botState.isSleeping || (type !== 'notify' && type !== 'append')) return;
        
        const msg = messages[0];
        if (!msg?.message) return;

        // Valid Map caching
        if (msg.key?.id) global.messageCache.set(msg.key.id, msg);

        const jid = msg.key.remoteJid;
        const isGroup = jid.endsWith('@g.us');
        
        const botId = sock.user?.id?.split(':')[0] || phoneNumber;
        const fullBotJid = `${botId}@s.whatsapp.net`;
        
        let text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || '';
        
        if (msg.message.ephemeralMessage) {
            const eph = msg.message.ephemeralMessage.message;
            text = eph?.conversation || eph?.extendedTextMessage?.text || eph?.imageMessage?.caption || eph?.videoMessage?.caption || '';
        }
        
        // Check if this is actually a sticker message (not text)
        const isActualSticker = !!(msg.message?.stickerMessage);
        
        // If it's a sticker, don't treat it as text
        if (isActualSticker) {
            text = ''; // Clear text so it doesn't trigger text responses
        }

        let isGroupAdmin = false;
        const sender = msg.key.fromMe ? fullBotJid : (msg.key.participant || msg.key.remoteJid);

        // ── STICKER TRIGGER HANDLER ──────────────────────────────────────────
        let isStickerTriggered = false;
        if (msg.message?.stickerMessage && !text) {
            try {
                const sticker = msg.message.stickerMessage;
                const stickerIdBuffer = Buffer.from(sticker.fileSha256);
                const stickerId = stickerIdBuffer.toString('base64');
                if (stickerId) {
                    const bindDbPath = path.join(__dirname, '../data/stickerCmds.json');
                    if (fs.existsSync(bindDbPath)) {
                        const stickerDb = JSON.parse(fs.readFileSync(bindDbPath, 'utf-8'));
                        const boundCmd = stickerDb[stickerId];
                        if (boundCmd) {
                            text = boundCmd;
                            isStickerTriggered = true;
                            // Create a fake text message to avoid quoting the sticker
                            msg.message = {
                                conversation: boundCmd
                            };
                        }
                    }
                }
            } catch (e) {
                logger.error(`[Sticker Trigger] Error: ${e.message}`);
            }
        }

        if (isGroup) {
            try {
                const meta = await sock.groupMetadata(jid);
                const participant = meta.participants.find(p => p.id === sender);
                isGroupAdmin = participant?.admin?.includes('admin');
            } catch (err) {
                // Silently ignore if group metadata fetch fails
            }
        }

        // ─── AI — only fires when .pappy on is active ────────────────────
        const { downloadMediaMessage } = require('gifted-baileys');
        const ai = require('./ai');
        
        const ctxInfo           = msg.message?.extendedTextMessage?.contextInfo;
        const mentionedJids     = ctxInfo?.mentionedJid || [];
        const isMentioned       = mentionedJids.some(j => j.startsWith(botId));
        const quotedParticipant = ctxInfo?.participant;
        const quotedStanzaId    = ctxInfo?.stanzaId;
        const cachedMsg         = quotedStanzaId ? global.messageCache.get(quotedStanzaId) : null;
        const isReplyToBot      = !!(quotedParticipant?.startsWith(botId)) || !!(cachedMsg?.key?.fromMe);
        const hasImage          = !!(msg.message?.imageMessage);
        const hasVoice          = !!(msg.message?.audioMessage?.ptt);
        const hasSticker        = !!(msg.message?.stickerMessage);
        const pappyOn           = botState.pappyMode?.[jid] === true;
        
        // Debug: log when sticker is detected
        if (hasSticker && pappyOn && isGroup) {
            logger.info(`[STICKER] Detected sticker message from ${sender}`);
        }
        
        // For stickers: also check if contextInfo exists (means it's a reply)
        const stickerCtxInfo = msg.message?.stickerMessage?.contextInfo;
        const stickerQuotedParticipant = stickerCtxInfo?.participant;
        const stickerQuotedStanzaId = stickerCtxInfo?.stanzaId;
        const stickerCachedMsg = stickerQuotedStanzaId ? global.messageCache.get(stickerQuotedStanzaId) : null;
        const isStickerReplyToBot = !!(stickerQuotedParticipant?.startsWith(botId)) || !!(stickerCachedMsg?.key?.fromMe);
        
        // Debug logging for stickers
        if (hasSticker && pappyOn && isGroup) {
            logger.info(`[STICKER DEBUG] hasSticker: ${hasSticker}, isMentioned: ${isMentioned}, isReplyToBot: ${isReplyToBot}, isStickerReplyToBot: ${isStickerReplyToBot}`);
            logger.info(`[STICKER DEBUG] stickerQuotedParticipant: ${stickerQuotedParticipant}, botId: ${botId}`);
            logger.info(`[STICKER DEBUG] stickerQuotedStanzaId: ${stickerQuotedStanzaId}, cachedMsg exists: ${!!stickerCachedMsg}`);
            logger.info(`[STICKER DEBUG] contextInfo exists: ${!!stickerCtxInfo}`);
            if (stickerCtxInfo) {
                logger.info(`[STICKER DEBUG] contextInfo keys: ${Object.keys(stickerCtxInfo).join(', ')}`);
            }
        }

        // AI ONLY responds when EXPLICITLY mentioned or replied to
        const shouldRespond = isGroup && pappyOn && (
            isMentioned || 
            isReplyToBot ||
            isStickerReplyToBot
        );
        
        if (shouldRespond && !text.startsWith(globalPrefix)) {
            // Show typing (no await - fire and forget)
            sock.sendPresenceUpdate('composing', jid).catch(() => {});
            
            // Log for debugging
            logger.info(`[AI] Triggered - Sticker: ${hasSticker}, Mentioned: ${isMentioned}, Reply: ${isReplyToBot}, StickerReply: ${isStickerReplyToBot}`);

            // Process async - don't block other messages
            (async () => {
                try {
                    let response = '';

                if (hasSticker) {
                    // User sent sticker - reply with STICKER ONLY (no text)
                    
                    const stickerPrompts = [
                        'cool anime character with glowing aura aesthetic',
                        'powerful anime warrior energy aura',
                        'aesthetic anime character epic vibe',
                        'anime character legendary pose glowing',
                        'sigma anime character energy aesthetic',
                        'anime protagonist power up aura glowing',
                        'epic anime power up scene glowing energy',
                        'legendary anime character aesthetic pose',
                        'anime character with cosmic aura background'
                    ];
                    
                    const randomPrompt = stickerPrompts[Math.floor(Math.random() * stickerPrompts.length)];
                    const cacheKey = Buffer.from(randomPrompt).toString('base64').slice(0, 20);
                    
                    // Send sticker only (no text)
                    try {
                        let stickerBuffer;
                        
                        if (global.stickerCache.has(cacheKey)) {
                            stickerBuffer = global.stickerCache.get(cacheKey);
                        } else {
                            const imgBuffer = await Promise.race([
                                ai.generateImage(randomPrompt),
                                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 12000))
                            ]);
                            
                            const sharp = require('sharp');
                            stickerBuffer = await sharp(imgBuffer)
                                .resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
                                .webp({ quality: 90 })
                                .toBuffer();
                            
                            if (global.stickerCache.size >= 50) {
                                const firstKey = global.stickerCache.keys().next().value;
                                global.stickerCache.delete(firstKey);
                            }
                            global.stickerCache.set(cacheKey, stickerBuffer);
                        }
                        
                        await sock.sendMessage(jid, { sticker: stickerBuffer });
                        logger.success('[AI] Sticker sent');
                    } catch (err) {
                        logger.error(`[AI] Sticker failed: ${err.message}`);
                    }
                    
                    return;
                } else if (hasImage) {
                    const imgBuffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: null, reuploadRequest: sock.updateMediaMessage });
                    const prompt = text.replace(/@\d+/g, '').trim() || 'Describe this image';
                    response = await ai.analyzeImage(imgBuffer, prompt, sender);
                } else if (hasVoice) {
                    const audioBuffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: null, reuploadRequest: sock.updateMediaMessage });
                    response = await ai.analyzeVoice(audioBuffer, sender);
                    
                    // Reply with voice note instead of text
                    try {
                        const voiceReply = await ai.textToSpeech(response);
                        await sock.sendMessage(jid, { audio: voiceReply, mimetype: 'audio/mpeg', ptt: true }, { quoted: msg });
                        return;
                    } catch (ttsErr) {
                        logger.warn(`[AI] TTS failed, sending text: ${ttsErr.message}`);
                        // Fall through to send text response
                    }
                } else if (text) {
                    const cleanPrompt = text.replace(/@\d+/g, '').trim();
                    if (!cleanPrompt) return;
                    response = await ai.generateText(cleanPrompt, sender);
                } else return;

                if (response.startsWith('PLAY:')) {
                    const musicModule = require('../plugins/pappy-music');
                    await musicModule.execute({ sock, msg, args: response.slice(5).trim().split(' '), text: `.play ${response.slice(5).trim()}`, user: { name: 'AI' }, botId });
                    return;
                }
                if (response.startsWith('GENERATE_IMAGE:')) {
                    try { await sock.sendMessage(jid, { image: await ai.generateImage(response.slice(15).trim()), caption: '' }, { quoted: msg }); }
                    catch { await sock.sendMessage(jid, { text: "couldn't generate that image" }, { quoted: msg }); }
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
                    } catch { await sock.sendMessage(jid, { text: "couldn't find that video" }, { quoted: msg }); }
                    return;
                }
                if (response.startsWith('SEND_STICKER:')) {
                    try {
                        const description = response.slice(13).trim();
                        const cacheKey = Buffer.from(description).toString('base64').slice(0, 20);
                        
                        let stickerBuffer;
                        
                        // Check cache first
                        if (global.stickerCache.has(cacheKey)) {
                            logger.info('[AI] Using cached sticker');
                            stickerBuffer = global.stickerCache.get(cacheKey);
                        } else {
                            logger.info(`[AI] Generating sticker: ${description}`);
                            const imgBuffer = await Promise.race([
                                ai.generateImage(description),
                                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 12000))
                            ]);
                            
                            const sharp = require('sharp');
                            stickerBuffer = await sharp(imgBuffer)
                                .resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
                                .webp({ quality: 90 })
                                .toBuffer();
                            
                            // Cache it
                            if (global.stickerCache.size >= 50) {
                                const firstKey = global.stickerCache.keys().next().value;
                                global.stickerCache.delete(firstKey);
                            }
                            global.stickerCache.set(cacheKey, stickerBuffer);
                        }
                        
                        // Send without quoting to avoid old message issues
                        await sock.sendMessage(jid, { sticker: stickerBuffer });
                        logger.success('[AI] Sticker sent & cached');
                    } catch (err) {
                        logger.error(`[AI] Sticker failed: ${err.message}`);
                        await sock.sendMessage(jid, { text: "couldn't make that sticker rn" }, { quoted: msg });
                    }
                    return;
                }

                await sock.sendMessage(jid, { text: response }, { quoted: msg });
                
                // Send ONE sticker after text for aura farming (no spam)
                try {
                    const stickerPrompts = [
                        'cool anime character with glowing aura aesthetic',
                        'powerful anime warrior energy aura',
                        'aesthetic anime character epic vibe',
                        'anime character legendary pose glowing',
                        'sigma anime character energy aesthetic',
                        'anime protagonist power up aura glowing'
                    ];
                    
                    const randomPrompt = stickerPrompts[Math.floor(Math.random() * stickerPrompts.length)];
                    const cacheKey = Buffer.from(randomPrompt).toString('base64').slice(0, 20);
                    
                    let stickerBuffer;
                    if (global.stickerCache.has(cacheKey)) {
                        stickerBuffer = global.stickerCache.get(cacheKey);
                    } else {
                        const imgBuffer = await Promise.race([
                            ai.generateImage(randomPrompt),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 12000))
                        ]);
                        
                        const sharp = require('sharp');
                        stickerBuffer = await sharp(imgBuffer)
                            .resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
                            .webp({ quality: 90 })
                            .toBuffer();
                        
                        if (global.stickerCache.size >= 50) {
                            const firstKey = global.stickerCache.keys().next().value;
                            global.stickerCache.delete(firstKey);
                        }
                        global.stickerCache.set(cacheKey, stickerBuffer);
                    }
                    
                    await sock.sendMessage(jid, { sticker: stickerBuffer });
                } catch (err) {
                    logger.error(`[AI] Sticker after text failed: ${err.message}`);
                }

            } catch (err) {
                logger.warn(`[AI] Failed: ${err.message}`);
                await sock.sendMessage(jid, { text: 'something went wrong, try again' }, { quoted: msg }).catch(() => {});
            }
            })(); // End async IIFE
            return;
        }

        engine.triggerMessage({ sock, msg, text, isGroup, sender, botId, isGroupAdmin });
    });

    return sock;
}

function setPappyMode(jid, value) {
    if (!botState.pappyMode) botState.pappyMode = {};
    botState.pappyMode[jid] = value;
    saveState();
}

module.exports = { startWhatsApp, activeSockets, loadState, saveState, botState, setPappyMode };
