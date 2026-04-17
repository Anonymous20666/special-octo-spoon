// plugins/pappy-groupstatus.js
const { downloadMediaMessage } = require('gifted-baileys');
const { broadcastQueue } = require('../core/bullEngine');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../core/logger');

const TEMP_DIR = path.join(__dirname, '../data/temp_media');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const BG_COLORS = { black: '#000000', blue: '#1A73E8', red: '#E53935', purple: '#7B1FA2' };
const FONTS = { sans: 0, serif: 1, mono: 2, bold: 4 };
const gsConfig = { backgroundColor: BG_COLORS.black, font: FONTS.sans, repeat: 1 };
const yieldLoop = () => new Promise(resolve => setImmediate(resolve));

module.exports = {
    category: 'STATUS',
    commands: [
        { cmd: '.updategstatus', role: 'public' },
        { cmd: '.gstatus', role: 'owner' },
        { cmd: '.ggstatus', role: 'owner' }
    ],
    getGsConfig: () => gsConfig,
    setGsConfig: (p) => Object.assign(gsConfig, p),
    BG_COLORS, FONTS,

    execute: async ({ sock, msg, args, text, user, botId }) => {
        const chat = msg.key.remoteJid;
        const commandName = text.split(' ')[0].toLowerCase();
        
        let targetJids = [];
        let amount = gsConfig.repeat;
        let textContent = '';

        const quotedText = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation || 
                           msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text || '';

        if (commandName === '.gstatus') {
            amount = parseInt(args[0]) || 1;
            targetJids = [args[1]];
            textContent = args.slice(2).join(' ') || quotedText;
        } else if (commandName === '.ggstatus') {
            amount = parseInt(args[0]) || 1;
            textContent = args.slice(1).join(' ') || quotedText;
            try {
                const all = await sock.groupFetchAllParticipating();
                targetJids = Object.keys(all);
            } catch (err) { return sock.sendMessage(chat, { text: `❌ Failed to fetch groups: ${err.message}` }); }
        } else {
            // 👑 RESTORED: This targets the exact GC you are in!
            targetJids = [chat]; 
            textContent = args.join(' ') || quotedText; 
        }

        let mediaPath = null;
        let isVideo = false;
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const hasMedia = quotedMsg?.imageMessage || quotedMsg?.videoMessage;

        if (hasMedia) {
            try {
                const ext = quotedMsg.videoMessage ? '.mp4' : '.jpg';
                isVideo = !!quotedMsg.videoMessage;
                mediaPath = path.join(TEMP_DIR, `GS_${crypto.randomBytes(4).toString('hex')}${ext}`);
                const buffer = await downloadMediaMessage({ key: msg.key, message: quotedMsg }, 'buffer', { }, { logger: null, reuploadRequest: sock.updateMediaMessage });
                await fs.promises.writeFile(mediaPath, buffer);
            } catch (mediaErr) { mediaPath = null; }
        }

        if (!textContent && !mediaPath) textContent = '🔱';

        const jobs = [];
        for (let i = 0; i < amount; i++) {
            targetJids.forEach(jid => {
                jobs.push({
                    name: `GS_${botId}_${jid}`,
                    data: {
                        botId, targetJid: jid, mode: 'advanced_status',
                        textContent: textContent, font: gsConfig.font, backgroundColor: gsConfig.backgroundColor,
                        useGhostProtocol: true, mediaPath, isVideo
                    },
                    opts: { removeOnComplete: true, removeOnFail: 1000, priority: 2 }
                });
            });
        }

        const CHUNK_SIZE = 500;
        for (let i = 0; i < jobs.length; i += CHUNK_SIZE) {
            try {
                await broadcastQueue.addBulk(jobs.slice(i, i + CHUNK_SIZE));
                await yieldLoop(); 
            } catch (err) { logger.error(err.message); }
        }

        await sock.sendMessage(chat, { text: `✅ *Status Queue Engaged*\nSuccessfully pushed ${jobs.length} jobs to the BullMQ Engine.` });
    }
};
