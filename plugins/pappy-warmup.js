// plugins/pappy-warmup.js
// 👑 SUPREME GOD MODE: WARMUP ENGINE (Offloaded to BullMQ)

const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('gifted-baileys');
const { broadcastQueue } = require('../core/bullEngine'); 
const logger = require('../core/logger');

const CONFIG_FILE = path.join(__dirname, '../data/warmup-config.json');

function loadConfig() {
    if (fs.existsSync(CONFIG_FILE)) {
        try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); } 
        catch (e) { return { statusPayload: null, mediaType: null }; }
    }
    return { statusPayload: null, mediaType: null };
}

function saveConfig(data) {
    if (!fs.existsSync(path.dirname(CONFIG_FILE))) fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

module.exports = {
    category: 'STEALTH',
    commands: [
        { cmd: '.setnewgcstatus', role: 'public' },
        { cmd: '.checkgcstatus', role: 'public' },
        { cmd: '.delgcstatus', role: 'public' }
    ],

    init(sock) {
        const botId = sock.user?.id?.split(':')[0];
        if (!botId) return;
        const fullBotJid = `${botId}@s.whatsapp.net`;

        // When added to a new group, safely push the task to BullMQ
        sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
            if (action === 'add' && participants.includes(fullBotJid)) {
                triggerWarmup(id, botId);
            }
        });

        sock.ev.on('groups.upsert', async (newGroups) => {
            for (const group of newGroups) {
                triggerWarmup(group.id, botId);
            }
        });
    },

    execute: async (sock, msg, args, userProfile, cmd) => {
        const chat = msg.key.remoteJid;
        const config = loadConfig();

        if (cmd === '.setnewgcstatus') {
            await sock.sendMessage(chat, { text: '⚙️ Securing your new God-Mode entry drop...' });
            let textContent = args.join(' ');
            const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            
            let mediaMsg = msg.message?.imageMessage || msg.message?.videoMessage;
            if (!mediaMsg && quotedMsg) {
                mediaMsg = quotedMsg.imageMessage || quotedMsg.videoMessage;
                if (!textContent) {
                    textContent = quotedMsg.imageMessage?.caption || quotedMsg.videoMessage?.caption || quotedMsg.conversation || '';
                }
            } else if (msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption) {
                const rawCaption = msg.message.imageMessage?.caption || msg.message.videoMessage?.caption;
                textContent = rawCaption.replace('.setnewgcstatus', '').trim();
            }

            let mediaType = null;
            if (mediaMsg) {
                try {
                    mediaType = mediaMsg.mimetype.startsWith('image/') ? 'image' : 'video';
                    const stream = await downloadContentFromMessage(mediaMsg, mediaType);
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }
                    
                    const ext = mediaType === 'image' ? 'jpg' : 'mp4';
                    const mediaPath = path.join(__dirname, `../data/warmup-media.${ext}`);
                    fs.writeFileSync(mediaPath, buffer);
                } catch (err) {
                    return sock.sendMessage(chat, { text: `❌ *Media Save Error:* ${err.message}` });
                }
            }

            if (!textContent && !mediaType) {
                return sock.sendMessage(chat, { text: '❌ *Usage:* Send or reply to an image/video/text with `.setnewgcstatus Your message`' });
            }

            config.statusPayload = textContent;
            config.mediaType = mediaType;
            saveConfig(config);

            const typeMsg = mediaType ? (mediaType === 'image' ? '🖼️ Image' : '🎥 Video') : '📝 GC Status Ring';
            return sock.sendMessage(chat, { text: `👑 *God Mode Drop Secured!*\n\n*Type:* ${typeMsg}\n*Caption:* ${textContent || 'None'}\n\n_I will forcefully push this into the GC Status Ring via BullMQ._` });
        }

        if (cmd === '.checkgcstatus') {
            if (!config.statusPayload && !config.mediaType) return sock.sendMessage(chat, { text: 'ℹ️ No God Mode entry set.' });
            const typeMsg = config.mediaType ? (config.mediaType === 'image' ? '🖼️ Image' : '🎥 Video') : '📝 GC Status Ring';
            return sock.sendMessage(chat, { text: `👑 *Current Entry Drop:*\n\n*Media:* ${typeMsg}\n*Text:* "${config.statusPayload || 'None'}"` });
        }

        if (cmd === '.delgcstatus') {
            config.statusPayload = null;
            config.mediaType = null;
            saveConfig(config);
            return sock.sendMessage(chat, { text: '🗑️ *Entry Drop Cleared.*' });
        }
    }
};

/**
 * 👑 THE WARMUP SEQUENCE (Now powered safely by BullMQ)
 */
function triggerWarmup(groupId, botId) {
    const config = loadConfig();
    if (!config.statusPayload && !config.mediaType) return;

    logger.info(`🔥 [GOD MODE WARMUP] Pushing to BullMQ queue for: ${groupId}`);

    let mediaPath = null;
    let isVideo = false;

    if (config.mediaType) {
        const ext = config.mediaType === 'image' ? 'jpg' : 'mp4';
        const checkPath = path.join(__dirname, `../data/warmup-media.${ext}`);
        if (fs.existsSync(checkPath)) {
            mediaPath = checkPath;
            isVideo = config.mediaType === 'video';
        }
    }

    // Hand off the heavy lifting to BullMQ. It will handle the ghost protocol,
    // retries, and rate limits without blocking your bot's memory!
    broadcastQueue.add(`WARMUP_${botId}_${groupId}`, {
        botId,
        targetJid: groupId,
        textContent: config.statusPayload || '',
        mode: 'advanced_status',
        font: 3,
        backgroundColor: '#FFB7C5',
        mediaPath,
        isVideo,
        useGhostProtocol: true // 👻 Forces the ghost text sequence
    }, {
        priority: 1, // High priority so warmups happen immediately
        removeOnComplete: true,
        removeOnFail: 1000
    });
}
