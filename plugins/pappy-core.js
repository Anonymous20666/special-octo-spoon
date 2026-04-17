// plugins/pappy-core.js
// System Hub & Ghost Protocols (10x Premium Dynamic Aesthetics - SaaS Edition)

const fs = require('fs');
const path = require('path');
const { generateMenu } = require('../modules/menuEngine');
const logger = require('../core/logger');

const bindDbPath = path.join(__dirname, '../data/stickerCmds.json');

// 🧠 SaaS Fix: RAM Cache for Sticker DB
let stickerDbCache = null;

async function initStickerDb() {
    try {
        if (!fs.existsSync(path.join(__dirname, '../data'))) {
            await fs.promises.mkdir(path.join(__dirname, '../data'), { recursive: true });
        }
        if (fs.existsSync(bindDbPath)) {
            const data = await fs.promises.readFile(bindDbPath, 'utf-8');
            stickerDbCache = JSON.parse(data);
        } else {
            stickerDbCache = {};
        }
    } catch (err) {
        logger.error(`[CorePlugin] Failed to load sticker DB: ${err.message}`);
        stickerDbCache = {};
    }
}

// Ensure the cache is loaded when the plugin boots
initStickerDb();

async function saveStickerDb() {
    try {
        await fs.promises.writeFile(bindDbPath, JSON.stringify(stickerDbCache, null, 2));
    } catch (err) {
        logger.error(`[CorePlugin] Failed to save sticker DB to disk: ${err.message}`);
    }
}

// 🎨 10 PREMIUM AESTHETIC THEMES
const menuAesthetics = [
    (cmds, name, role) => `*⎔ OMEGA_OS // V2.0 ⎔*\n\nWelcome back, *${name}*.\nAccess Level: [${role}]\nAll systems optimal. 🟢\n\n> ───「 *CORE MODULES* 」─── <\n\n${cmds}\n\n*<// END TRANSMISSION>*</_>`,
    (cmds, name, role) => `⚜️ *O M E G A  E L I T E* ⚜️\n───────────────\nGreetings, *${name}*.\nClearance: ${role}\n\n${cmds}\n───────────────\n_Excellence in execution._`,
    (cmds, name, role) => `🌃 *N E X U S  C O R E* 🌃\n💫 User: ${name} [${role}]\n\n*⟪ COMMAND DIRECTORY ⟫*\n\n${cmds}\n\n⚡ _Stay wired._`,
    (cmds, name, role) => `🥷 *G H O S T _ N E T* 🥷\n\nAgent: *${name}*\nStatus: [CLASSIFIED / ${role}]\n\n${cmds}\n\n_We operate in the shadows._`,
    (cmds, name, role) => `🟩 *T E R M I N A L* 🟩\nlogin: ${name}\naccess: GRANTED (${role})\n\n[=== EXECUTE ===]\n\n${cmds}\n\n_Wake up, Neo..._`,
    (cmds, name, role) => `🌌 *A S T R A L  C O R E* 🌌\n\n✨ Commander: *${name}*\n🚀 Rank: ${role}\n\n✧ ─── *Constellations* ─── ✧\n\n${cmds}\n\n_To the stars._ 🌠`,
    (cmds, name, role) => `🌸 *O M E G A  C h a n* 🌸\n\nHiii *${name}*! (≧◡≦) ♡\nYour role is: ${role} ✨\n\n╭・✦ 🎀 *Commands* 🎀 ✦・╮\n\n${cmds}\n\n╰・┈┈┈┈┈┈┈┈┈┈┈┈┈┈・╯\n_Let's do our best today!_ 💖`,
    (cmds, name, role) => `🩸 *V A M P I R I C  C O R E* 🩸\n\nLord *${name}*, the night is ours.\nBloodline: ${role}\n\n🦇 ── *Dark Arts* ── 🦇\n\n${cmds}\n\n_Eternity awaits._ 🥀`,
    (cmds, name, role) => `👾 *A R C A D E  M O D E* 👾\n\nPLAYER 1: *${name}*\nCLASS: ${role}\nREADY!\n\n🕹️ ── *MOVESET* ── 🕹️\n\n${cmds}\n\n_INSERT COIN TO CONTINUE_ 🪙`,
    (cmds, name, role) => `👑 *T H E  I M P E R I U M* 👑\n\nBy order of *${name}*:\nAuthority: ${role}\n\n📜 ── *Decrees* ── 📜\n\n${cmds}\n\n_Long live the Empire._ ⚔️`
];

module.exports = {
    category: 'SYSTEM',
    commands: [
        { cmd: '.menu', role: 'public' },
        { cmd: '.sys', role: 'public' },
        { cmd: '.bind', role: 'public' }
    ],

    // 🧠 SaaS Fix: Updated signature to match central Command Router
    execute: async ({ sock, msg, args, text, user }) => {
        const jid = msg.key.remoteJid;
        const commandName = text.split(' ')[0].toLowerCase();

        // 1. DYNAMIC RANDOM AESTHETIC MENU
        if (commandName === '.menu') {
            let rawMenu = generateMenu(user.role);
            
            // Strip the hardcoded headers from menuEngine.js so our new themes fit perfectly!
            rawMenu = rawMenu
                .replace(/╔════════════════════╗\n   Ω ELITE MENU\n╚════════════════════╝\n👤 Access Level: \*(.*?)\*\n\n/, '')
                .replace(/> Powered by Elite Engine/g, '')
                .trim();
            
            const randomStyle = menuAesthetics[Math.floor(Math.random() * menuAesthetics.length)];
            const menuHtml = randomStyle(rawMenu, user.name || 'Operator', user.role.toUpperCase());
            
            // 💎 PREMIUM TOUCH: Rich Ad Reply context card
            return sock.sendMessage(jid, { 
                text: menuHtml,
                contextInfo: {
                    externalAdReply: {
                        title: "Ω OMEGA ELITE ENGINE",
                        body: "Enterprise WhatsApp Solutions",
                        mediaType: 1,
                        renderLargerThumbnail: true, // Upgraded for high impact
                        thumbnailUrl: "https://i.imgur.com/4ZQZ4ZQ.jpeg", // Replace with your preferred aesthetic cover
                        sourceUrl: "https://t.me/holyPappy" 
                    }
                }
            }, { quoted: msg });
        }

        // 2. SYSTEM STATS (Upgraded with Uptime calculation)
        if (commandName === '.sys') {
            const mem = process.memoryUsage();
            const uptime = process.uptime();
            const hrs = Math.floor(uptime / 3600);
            const mins = Math.floor((uptime % 3600) / 60);
            const secs = Math.floor(uptime % 60);

            const stats = `⚙️ *SYSTEM TELEMETRY*\n\n` +
                          `⏱️ *Uptime:* ${hrs}h ${mins}m ${secs}s\n` +
                          `🧠 *RAM Usage:* ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB / ${(mem.heapTotal / 1024 / 1024).toFixed(2)} MB\n` +
                          `⚡ *Ping:* Responsive\n` +
                          `👨‍💻 *Operator:* https://t.me/holyPappy`;
                          
            return sock.sendMessage(jid, { text: stats });
        }

        // 3. GHOST BINDER (Bind commands to stickers)
        if (commandName === '.bind') {
            const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const sticker = quotedMsg?.stickerMessage;
            
            if (!sticker) return sock.sendMessage(jid, { text: "꒰ ❌ ꒱ Reply to a sticker to bind." });

            let commandToBind = args.join(' ');
            if (!commandToBind) return sock.sendMessage(jid, { text: "꒰ ❌ ꒱ Usage: .bind .flashtag 50" });

            const stickerId = sticker.fileSha256.toString('base64');
            
            // Ensure cache is ready
            if (!stickerDbCache) await initStickerDb();
            
            // Bind and save asynchronously 
            stickerDbCache[stickerId] = commandToBind.startsWith('.') ? commandToBind : `.${commandToBind}`;
            await saveStickerDb();

            // Stealth delete
            sock.sendMessage(jid, { delete: msg.key }).catch(() => {});
            
            return sock.sendMessage(jid, { text: `⚡ *Ghost Trigger Bound:* \`${stickerDbCache[stickerId]}\`` });
        }
    }
};
