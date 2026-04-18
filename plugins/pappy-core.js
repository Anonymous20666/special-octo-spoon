'use strict';
// plugins/pappy-core.js

const fs   = require('fs');
const path = require('path');
const axios = require('axios');
const { generateMenu } = require('../modules/menuEngine');
const logger = require('../core/logger');
const { createContextInfo } = require('../core/linkPreview');

const bindDbPath = path.join(__dirname, '../data/stickerCmds.json');
let stickerDbCache = null;

async function initStickerDb() {
    try {
        await fs.promises.mkdir(path.join(__dirname, '../data'), { recursive: true });
        stickerDbCache = fs.existsSync(bindDbPath)
            ? JSON.parse(await fs.promises.readFile(bindDbPath, 'utf-8'))
            : {};
    } catch { stickerDbCache = {}; }
}
initStickerDb();

async function saveStickerDb() {
    try { await fs.promises.writeFile(bindDbPath, JSON.stringify(stickerDbCache, null, 2)); } catch {}
}

// Pollinations — no API key, totally free, returns image buffer
const POLLINATIONS_PROMPTS = [
    'aesthetic dark cyberpunk bot interface glowing neon',
    'ethereal galaxy stars purple blue digital art',
    'luxury black gold elite hacker terminal aesthetic',
    'soft pink cherry blossom anime aesthetic dreamy',
    'dark omega elite ghost net hacker aesthetic',
    'neon green matrix terminal code rain aesthetic',
    'midnight blue stars constellation cosmic aesthetic',
    'red black vampire dark aesthetic gothic art',
    'arcade retro pixel art neon glow aesthetic',
    'golden empire crown luxury dark aesthetic',
];

async function getPollinationsImage() {
    const prompt = POLLINATIONS_PROMPTS[Math.floor(Math.random() * POLLINATIONS_PROMPTS.length)];
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=800&height=450&nologo=true&seed=${Math.floor(Math.random() * 99999)}`;
    try {
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 3000 });
        return Buffer.from(res.data);
    } catch {
        return null;
    }
}

// Public menu — useful commands visible to everyone
const PUBLIC_COMMANDS = `╭─❑ *GENERAL* ❑
│ • .menu — show this menu
│ • .sys — system stats
│ • .pappy on/off — toggle AI replies
│ • .img [desc] — generate image
│ • .tts [text] — text to voice note
│ • .video [search] — send video
│ • .play [song] — play music
╰─────────────────

╭─❑ *GROUP* ❑
│ • .tagall — tag all members
│ • .promote — promote member
│ • .demote — demote member
╰─────────────────

╭─❑ *OWNER* ❑
│ • .sudo [number] — add sudo user
│ • .delsudo [number] — remove sudo
╰─────────────────`;

const menuAesthetics = [
    (cmds, name, role) => `*⎔ OMEGA_OS // V2.0 ⎔*\n\nWelcome back, *${name}*.\nAccess Level: [${role}]\nAll systems optimal. 🟢\n\n> ───「 *CORE MODULES* 」─── <\n\n${cmds}\n\n*<// END TRANSMISSION>*`,
    (cmds, name, role) => `⚜️ *O M E G A  E L I T E* ⚜️\n───────────────\nGreetings, *${name}*.\nClearance: ${role}\n\n${cmds}\n───────────────\n_Excellence in execution._`,
    (cmds, name, role) => `🌃 *N E X U S  C O R E* 🌃\n💫 User: ${name} [${role}]\n\n*⟪ COMMAND DIRECTORY ⟫*\n\n${cmds}\n\n⚡ _Stay wired._`,
    (cmds, name, role) => `🥷 *G H O S T _ N E T* 🥷\n\nAgent: *${name}*\nStatus: [CLASSIFIED / ${role}]\n\n${cmds}\n\n_We operate in the shadows._`,
    (cmds, name, role) => `🟩 *T E R M I N A L* 🟩\nlogin: ${name}\naccess: GRANTED (${role})\n\n[=== EXECUTE ===]\n\n${cmds}\n\n_Wake up, Neo..._`,
    (cmds, name, role) => `🌌 *A S T R A L  C O R E* 🌌\n\n✨ Commander: *${name}*\n🚀 Rank: ${role}\n\n✧ ─── *Constellations* ─── ✧\n\n${cmds}\n\n_To the stars._ 🌠`,
    (cmds, name, role) => `🌸 *O M E G A  C h a n* 🌸\n\nHiii *${name}*! (≧◡≦) ♡\nYour role is: ${role} ✨\n\n╭・✦ 🎀 *Commands* 🎀 ✦・╮\n\n${cmds}\n\n╰・┈┈┈┈┈┈┈┈┈┈┈┈┈┈・╯\n_Let's do our best today!_ 💖`,
    (cmds, name, role) => `🩸 *V A M P I R I C  C O R E* 🩸\n\nLord *${name}*, the night is ours.\nBloodline: ${role}\n\n🦇 ── *Dark Arts* ── 🦇\n\n${cmds}\n\n_Eternity awaits._ 🥀`,
    (cmds, name, role) => `👾 *A R C A D E  M O D E* 👾\n\nPLAYER 1: *${name}*\nCLASS: ${role}\nREADY!\n\n🕹️ ── *MOVESET* ── 🕹️\n\n${cmds}\n\n_INSERT COIN TO CONTINUE_ 🪙`,
    (cmds, name, role) => `👑 *T H E  I M P E R I U M* 👑\n\nBy order of *${name}*:\nAuthority: ${role}\n\n📜 ── *Decrees* ── 📜\n\n${cmds}\n\n_Long live the Empire._ ⚔️`,
];

module.exports = {
    category: 'SYSTEM',
    commands: [
        { cmd: '.menu',    role: 'public' },
        { cmd: '.sys',     role: 'public' },
        { cmd: '.pappy',   role: 'admin'  },

        { cmd: '.tts',     role: 'public' },
        { cmd: '.video',   role: 'public' },
        { cmd: '.sudo',    role: 'owner'  },
        { cmd: '.delsudo', role: 'owner'  },
        { cmd: '.bind',    role: 'owner'  },
    ],

    execute: async ({ sock, msg, args, text, user }) => {
        const jid = msg.key.remoteJid;
        const cmd = text.split(' ')[0].toLowerCase();

        if (cmd === '.menu') {
            try {
                let rawMenu;
                if (user.role === 'owner') {
                    rawMenu = generateMenu('owner')
                        .replace(/╔════════════════════╗\n   Ω ELITE MENU\n╚════════════════════╝\n👤 Access Level: \*(.*?)\*\n\n/, '')
                        .replace(/> Powered by Elite Engine/g, '')
                        .trim();
                } else {
                    rawMenu = PUBLIC_COMMANDS;
                }

                const randomStyle = menuAesthetics[Math.floor(Math.random() * menuAesthetics.length)];
                const menuText = randomStyle(rawMenu, user.name || 'Operator', user.role.toUpperCase());
                
                const menuImage = await Promise.race([
                    getPollinationsImage(),
                    new Promise(resolve => setTimeout(() => resolve(null), 2000))
                ]);
                
                if (menuImage) {
                    await sock.sendMessage(jid, { image: menuImage, caption: menuText });
                } else {
                    await sock.sendMessage(jid, { text: menuText });
                }
            } catch (err) {
                logger.error(`[.menu] Error: ${err.message}`);
                return sock.sendMessage(jid, { text: '❌ Menu failed. Try again.' }).catch(() => {});
            }
            return;
        }

        if (cmd === '.pappy') {
            const action = args[0]?.toLowerCase();
            const { botState, setPappyMode } = require('../core/whatsapp');

            if (action === 'on') {
                setPappyMode(jid, true);

                try {
                    const meta = await sock.groupMetadata(jid);
                    const botJid = `${sock.user.id.split(':')[0]}@s.whatsapp.net`;
                    const members = meta.participants
                        .map(p => p.id)
                        .filter(id => id !== botJid);

                    const intros = ['tch xup gng', 'yo xup gng', 'aye xup gng', 'sup gng', 'oi xup gng'];
                    const introText = intros[Math.floor(Math.random() * intros.length)];

                    await sock.sendMessage(jid, {
                        text: introText,
                        mentions: members,
                    });
                } catch (err) {
                    logger.warn('[Pappy] tagall on activate failed', { error: err.message });
                }
                return;
            }

            if (action === 'off') {
                setPappyMode(jid, false);
                return sock.sendMessage(jid, { text: '❌ Pappy mode deactivated' });
            }

            const isOn = botState.pappyMode?.[jid] === true;
            return sock.sendMessage(jid, { text: `pappy mode: ${isOn ? 'on' : 'off'}` });
        }



        if (cmd === '.tts') {
            const speakText = args.join(' ');
            if (!speakText) return sock.sendMessage(jid, { text: 'Usage: .tts [text]\nExample: .tts hello how are you' }, { quoted: msg });
            try {
                const aiModule = require('../core/ai');
                const buf = await aiModule.textToSpeech(speakText);
                return sock.sendMessage(jid, { audio: buf, mimetype: 'audio/mpeg', ptt: true }, { quoted: msg });
            } catch {
                return sock.sendMessage(jid, { text: "Couldn't generate voice, try again." }, { quoted: msg });
            }
        }

        if (cmd === '.video') {
            const query = args.join(' ');
            if (!query) return sock.sendMessage(jid, { text: 'Usage: .video [search]\nExample: .video funny cats' }, { quoted: msg });
            const searching = await sock.sendMessage(jid, { text: `🔍 Searching: ${query}...` }, { quoted: msg });
            try {
                const aiModule = require('../core/ai');
                const { buffer, title } = await aiModule.searchVideo(query);
                await sock.sendMessage(jid, { video: buffer, caption: title, mimetype: 'video/mp4' }, { quoted: msg });
                await sock.sendMessage(jid, { delete: searching.key }).catch(() => {});
            } catch {
                await sock.sendMessage(jid, { text: "Couldn't find that video, try .play for audio only." }, { quoted: msg });
                await sock.sendMessage(jid, { delete: searching.key }).catch(() => {});
            }
            return;
        }

        if (cmd === '.sys') {
            const mem    = process.memoryUsage();
            const uptime = process.uptime();
            const hrs    = Math.floor(uptime / 3600);
            const mins   = Math.floor((uptime % 3600) / 60);
            const secs   = Math.floor(uptime % 60);
            return sock.sendMessage(jid, {
                text: `⚙️ *SYSTEM TELEMETRY*\n\n` +
                      `⏱️ *Uptime:* ${hrs}h ${mins}m ${secs}s\n` +
                      `🧠 *RAM:* ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB / ${(mem.heapTotal / 1024 / 1024).toFixed(2)} MB\n` +
                      `⚡ *Status:* Online\n` +
                      `👨‍💻 *Channel:* https://t.me/pappylung`
            });
        }

        if (cmd === '.sudo') {
            const ownerManager = require('../modules/ownerManager');
            const target = args[0]?.replace(/[^0-9]/g, '');
            if (!target) return sock.sendMessage(jid, { text: 'Usage: .sudo 2348012345678' }, { quoted: msg });
            const targetJid = `${target}@s.whatsapp.net`;
            await ownerManager.addSudo(targetJid);
            return sock.sendMessage(jid, { text: `✅ Added sudo: @${target}`, mentions: [targetJid] }, { quoted: msg });
        }

        if (cmd === '.delsudo') {
            const ownerManager = require('../modules/ownerManager');
            const target = args[0]?.replace(/[^0-9]/g, '');
            if (!target) return sock.sendMessage(jid, { text: 'Usage: .delsudo 2348012345678' }, { quoted: msg });
            const targetJid = `${target}@s.whatsapp.net`;
            await ownerManager.removeSudo(targetJid);
            return sock.sendMessage(jid, { text: `🗑️ Removed sudo: @${target}`, mentions: [targetJid] }, { quoted: msg });
        }

        if (cmd === '.bind') {
            const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const sticker   = quotedMsg?.stickerMessage;
            if (!sticker) return sock.sendMessage(jid, { text: '꒰ ❌ ꒱ Reply to a sticker to bind.' });
            const commandToBind = args.join(' ');
            if (!commandToBind) return sock.sendMessage(jid, { text: '꒰ ❌ ꒱ Usage: .bind .command' });
            const stickerIdBuffer = Buffer.from(sticker.fileSha256);
            const stickerId = stickerIdBuffer.toString('base64');
            if (!stickerDbCache) await initStickerDb();
            stickerDbCache[stickerId] = commandToBind.startsWith('.') ? commandToBind : `.${commandToBind}`;
            await saveStickerDb();
            await sock.sendMessage(jid, { text: `⚡ *Ghost Trigger Bound*\n\n🔗 Command: \`${stickerDbCache[stickerId]}\`\n✅ Send this sticker to execute` });
            sock.sendMessage(jid, { delete: msg.key }).catch(() => {});
            return;
        }
    }
};
