'use strict';
// plugins/pappy-music.js — YouTube music downloader

const { exec } = require('child_process');
const util  = require('util');
const fs    = require('fs');
const path  = require('path');
const axios = require('axios');
const logger = require('../core/logger');

const execAsync = util.promisify(exec);
const TEMP_DIR  = path.join(__dirname, '../data/temp_media');
fs.mkdirSync(TEMP_DIR, { recursive: true });

async function searchAndDownload(query) {
    const safeQuery = query.replace(/[^a-zA-Z0-9 ]/g, '').trim();
    const outPath   = path.join(TEMP_DIR, `music_${Date.now()}.mp3`);
    const cookiesPath = path.join(__dirname, '../data/youtube_cookies.txt');

    try {
        // Fast download: skip metadata, use best audio only
        const cmd = `yt-dlp --cookies "${cookiesPath}" --js-runtimes node -x --audio-format mp3 --audio-quality 5 --max-filesize 10m --no-playlist --no-warnings --no-check-certificate -o "${outPath}" "ytsearch1:${safeQuery}"`;
        await execAsync(cmd, { timeout: 45000 }); // Reduced from 60s to 45s

        if (!fs.existsSync(outPath)) throw new Error('Download failed');

        const stats = fs.statSync(outPath);
        if (stats.size > 10 * 1024 * 1024) throw new Error('File too large');

        return outPath;
    } catch (err) {
        if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
        throw new Error(`Could not download: ${err.message}`);
    }
}

async function getTrackInfo(query) {
    const cookiesPath = path.join(__dirname, '../data/youtube_cookies.txt');
    try {
        const { stdout } = await execAsync(
            `yt-dlp --cookies "${cookiesPath}" --js-runtimes node --dump-json --no-playlist "ytsearch1:${query.replace(/[^a-zA-Z0-9 ]/g, '')}" --quiet`,
            { timeout: 15000 }
        );
        const info = JSON.parse(stdout);
        return {
            title:    info.title || query,
            uploader: info.uploader || 'Unknown',
            duration: info.duration ? `${Math.floor(info.duration / 60)}:${String(info.duration % 60).padStart(2, '0')}` : '?',
            thumb:    info.thumbnail || null,
        };
    } catch {
        return { title: query, uploader: 'Unknown', duration: '?', thumb: null };
    }
}

module.exports = {
    category: 'MUSIC',
    commands: [
        { cmd: '.play',   role: 'public' },
        { cmd: '.search', role: 'public' },
    ],

    // Exposed for AI to call directly
    searchAndDownload,
    getTrackInfo,

    execute: async ({ sock, msg, args, text, user }) => {
        const jid = msg.key.remoteJid;
        const cmd = text.split(' ')[0].toLowerCase();
        const query = args.join(' ');

        if (!query) return sock.sendMessage(jid, { text: '🎵 Usage: .play <song name>' }, { quoted: msg });

        // Only send status messages to real WhatsApp chats, not Telegram bridge
        const isRealWaChat = jid.endsWith('@g.us') || jid.endsWith('@s.whatsapp.net');
        if (isRealWaChat) {
            await sock.sendMessage(jid, { text: `🔍 *Searching for:* ${query}\n⏳ Please wait...` }, { quoted: msg });
        }

        try {
            const info    = await getTrackInfo(query);
            const outPath = await searchAndDownload(query);
            const buffer  = await fs.promises.readFile(outPath);

            // Only send audio to WhatsApp if this is a real group/chat (not a Telegram bridge call)
            const isRealWaChat = jid.endsWith('@g.us') || jid.endsWith('@s.whatsapp.net');
            if (isRealWaChat) {
                await sock.sendMessage(jid, {
                    audio:    buffer,
                    mimetype: 'audio/mpeg',
                    ptt:      false,
                    fileName: `${info.title}.mp3`,
                    contextInfo: {
                        externalAdReply: {
                            title:       info.title,
                            body:        `🎤 ${info.uploader} • ⏱ ${info.duration}`,
                            mediaType:   1,
                            sourceUrl:   'https://t.me/pappylung',
                            thumbnailUrl: info.thumb,
                        }
                    }
                }, { quoted: msg });
            }

            // Send to Telegram
            if (global.tgBot) {
                const { ownerTelegramId } = require('../config');
                await global.tgBot.telegram.sendAudio(ownerTelegramId, {
                    source: buffer,
                    filename: `${info.title}.mp3`,
                }, {
                    title:     info.title,
                    performer: info.uploader,
                    caption:   `🎵 *${info.title}*\n🎤 ${info.uploader}\n⏱ ${info.duration}\n\nRequested by: ${user.name || 'User'}`,
                    parse_mode: 'Markdown',
                }).catch(() => {});
            }

            fs.unlink(outPath, () => {});

        } catch (err) {
            logger.error(`[Music] Failed: ${err.message}`);
            // Only send error text to WhatsApp if it's a real chat
            const isRealWaChat = jid.endsWith('@g.us') || jid.endsWith('@s.whatsapp.net');
            if (isRealWaChat) {
                await sock.sendMessage(jid, {
                    text: `❌ *Could not find or download:* ${query}\n\nTry a more specific search.`
                }, { quoted: msg });
            } else if (global.tgBot) {
                const { ownerTelegramId } = require('../config');
                global.tgBot.telegram.sendMessage(ownerTelegramId, `❌ Could not find: *${query}*\nTry a more specific search.`, { parse_mode: 'Markdown' }).catch(() => {});
            }
        }
    }
};
