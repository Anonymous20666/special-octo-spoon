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

let botState = { isSleeping: false };
if (!global.messageCache) global.messageCache = new WeakMap();

if (!fs.existsSync(SESSIONS_PATH)) fs.mkdirSync(SESSIONS_PATH, { recursive: true });
if (!fs.existsSync(path.join(__dirname, '../data'))) fs.mkdirSync(path.join(__dirname, '../data'));

const loadState = () => { 
    if (fs.existsSync(STATE_FILE)) {
        try { botState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')); } 
        catch (e) { botState = { isSleeping: false }; }
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

        // Valid WeakMap caching
        global.messageCache.set(msg.key, msg);

        const jid = msg.key.remoteJid;
        const isGroup = jid.endsWith('@g.us');
        
        const botId = sock.user?.id?.split(':')[0] || phoneNumber;
        const fullBotJid = `${botId}@s.whatsapp.net`;
        
        let text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || '';
        
        if (msg.message.ephemeralMessage) {
            const eph = msg.message.ephemeralMessage.message;
            text = eph?.conversation || eph?.extendedTextMessage?.text || eph?.imageMessage?.caption || eph?.videoMessage?.caption || '';
        }

        let isGroupAdmin = false;
        const sender = msg.key.fromMe ? fullBotJid : (msg.key.participant || msg.key.remoteJid);

        if (isGroup) {
            try {
                const meta = await sock.groupMetadata(jid);
                const participant = meta.participants.find(p => p.id === sender);
                isGroupAdmin = participant?.admin?.includes('admin');
            } catch (err) {
                // Silently ignore if group metadata fetch fails
            }
        }

        engine.triggerMessage({ sock, msg, text, isGroup, sender, botId, isGroupAdmin });
    });

    return sock;
}

module.exports = { startWhatsApp, activeSockets, loadState, saveState, botState };
