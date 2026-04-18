// plugins/pappy-broadcast.js
// 👑 THE ULTIMATE GCAST/GODCAST HYBRID ENGINE

const fs = require('fs');
const path = require('path');
const { downloadMediaMessage } = require('gifted-baileys');
const { broadcastQueue } = require('../core/bullEngine'); 
const logger = require('../core/logger');
const crypto = require('crypto');

const SCHEDULE_FILE = path.join(__dirname, '../data/schedule-db.json');
const TEMP_DIR = path.join(__dirname, '../data/temp_media');
const activeSchedules = new Map();

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Prevents the event loop from blocking during massive array processing
const yieldLoop = () => new Promise(resolve => setImmediate(resolve));

// 🌸 SOFT LIFE & KAWAII BROADCAST WRAPPERS
const AESTHETIC_TEMPLATES = [
    (text) => `୨୧ ───────────── ୨୧\nnot everyone is allowed in… 💕\n${text}\nbut you are ♡`,
    (text) => `✧ ───────── ✧\ni probably shouldn't post this… 🎀\n${text}\njust join & see 👀♡`,
    (text) => `───────── ♡\nbutterfly effect 🦋\n${text}\nflutter in softly ♡`,
    (text) => `⋆ ˚｡⋆୨୧˚\nthis feels different…\n${text}\nyou'll see why ✨`,
    (text) => `꒰ঌ ────── ໒꒱\npretty energy only 💕\n${text}\nyou belong here ♡`,
    (text) => `✿ ───────── ✿\nlowkey not for everyone…\n${text}\nbut maybe you ♡`,
    (text) => `୨♡୧ ─────── ୨♡୧\nthis is your sign ✨\n${text}\ndon't ignore it ♡`,
    (text) => `✧･ﾟ: ───── :･ﾟ✧\nsoft space unlocked 🌸\n${text}\nstep in gently ♡`,
    (text) => `☾ ───────── ☽\nyou didn't see this… 👀\n${text}\njust join ♡`,
    (text) => `♡⃝ ───────── ♡⃝\nthis link is different 💎\n${text}\ntap & feel it ✧`,
    (text) => `⋆｡˚ ───── ˚｡⋆\nrich energy only 💎\n${text}\nstep like you own it ♡`,
    (text) => `❀ ───────── ❀\nwarning: bad b*tch vibes 🔥\n${text}\nhandle with care 😚`,
    (text) => `꒰ა ─────── ໒꒱\nnot for basic energy…\n${text}\nupgrade yourself ♡`,
    (text) => `✧♡ ───── ♡✧\nmain character only ✨\n${text}\nenter your era ♡`,
    (text) => `♡̷ ───────── ♡̷\nthis isn't regular…\n${text}\nit's elite 👀`,
    (text) => `⋆♡⋆ ───── ⋆♡⋆\nsoft but dangerous 🌸\n${text}\nyou'll feel it ♡`,
    (text) => `☁︎ ───────── ☁︎\nanime world unlocked 🦋\n${text}\nstep inside ♡`,
    (text) => `✧☾ ───── ☽✧\nkeep this lowkey…\n${text}\nreal ones only 👀`,
    (text) => `♡₊˚ ───── ˚₊♡\nluxury mindset 💎\n${text}\ntap different ♡`,
    (text) => `✿♡ ───── ♡✿\nyou found the vibe 🌸\n${text}\ndon't lose it ♡`,
    (text) => `⋆✧⋆ ───── ⋆✧⋆\nthis one hits hard 🔥\n${text}\nno explanation ♡`,
    (text) => `☾♡ ───── ♡☽\npretty but powerful 💕\n${text}\nwatch closely ♡`,
    (text) => `♡✧♡ ───── ♡✧♡\ndon't overthink it…\n${text}\njust enter ✨`,
    (text) => `❥ ───────── ❥\nsoft girl but make it rich 💎\n${text}\nlevel up ♡`,
    (text) => `♡˚ ───── ˚♡\nnot everyone gets access…\n${text}\nyou did ♡`,
    (text) => `✧❀✧ ───── ✧❀✧\ninvitation only 🎀\n${text}\nact fast ♡`,
    (text) => `☁︎♡ ───── ♡☁︎\ncalm but elite 🌸\n${text}\nfeel it ♡`,
    (text) => `♡⋆ ───── ⋆♡\nit's giving main energy ✨\n${text}\nstep in ♡`,
    (text) => `✧♡✧ ───── ✧♡✧\nbaddie zone 🔥\n${text}\nenter softly ♡`,
    (text) => `❀♡❀ ───── ❀♡❀\nyou might get obsessed 🍓\n${text}\ndon't blame me ♡`,
    (text) => `☾⋆ ───── ⋆☾\nsilent flex 💎\n${text}\nreal ones know ♡`,
    (text) => `♡☁︎♡ ───── ♡☁︎♡\nthis one's rare 💕\n${text}\ndon't miss it ♡`,
    (text) => `✧˚ ───── ˚✧\njust one click…\n${text}\nwatch what happens ♡`,
    (text) => `❥♡❥ ───── ❥♡❥\nyour era starts here ✨\n${text}\nstep up ♡`,
    (text) => `⋆❀⋆ ───── ⋆❀⋆\nsoft anime vibes 🦋\n${text}\ndrift in ♡`,
    (text) => `☾✧☽ ───── ☾✧☽\nexpensive taste only 💎\n${text}\nyou qualify ♡`,
    (text) => `♡⋆♡ ───── ♡⋆♡\nnew world unlocked ✨\n${text}\nexplore ♡`,
    (text) => `✧☁︎✧ ───── ✧☁︎✧\njust vibes 🌸\n${text}\ntap in ♡`,
    (text) => `❀⋆❀ ───── ❀⋆❀\ndon't scroll past…\n${text}\nyou'll regret it 👀`,
    (text) => `✿♡ ───── ♡✿♡\nlast chance… maybe 💕\n${text}\nbefore it's gone ♡`,
];

async function saveSchedules() { 
    try {
        const data = [...activeSchedules.values()].map(s => s.meta);
        await fs.promises.writeFile(SCHEDULE_FILE, JSON.stringify(data, null, 2)); 
    } catch (error) { logger.error(`[Broadcast] Failed to save schedules: ${error.message}`); }
}

function parseTime(input) {
    const value = parseInt(input);
    if (isNaN(value)) return null;
    if (input.endsWith('m')) return Date.now() + value * 60000;
    if (input.endsWith('h')) return Date.now() + value * 3600000;
    return null;
}

function queueSchedule(meta) {
    const delayMs = meta.time - Date.now();
    const waitTime = Math.max(delayMs, 2000);
    
    const timeout = setTimeout(async () => {
        try {
            const sock = global.waSocks?.get(meta.botId);
            if (sock) {
                const jids = await fetchAllGroups(sock, meta.botId);
                await executeBroadcastTask(sock, jids, meta.text, meta.mode, meta.chat, meta.isGodcast, null, false);
            }
        } catch (error) { logger.error(`[Broadcast] Schedule execution failed: ${error.message}`); } 
        finally {
            if (meta.isLoop) {
                meta.time += meta.loopInterval; 
                queueSchedule(meta); 
                saveSchedules();
            } else {
                activeSchedules.delete(meta.id); 
                saveSchedules();
            }
        }
    }, waitTime);
    
    activeSchedules.set(meta.id, { timeout, meta });
}

async function fetchAllGroups(sock, botId, minMembers = 5) {
    const raw = await sock.groupFetchAllParticipating();
    return Object.values(raw)
        .filter(g => g.participants.length >= minMembers)
        .map(g => ({ id: g.id, size: g.participants.length }));
}

// ==========================================
// 🚀 SUPREME BROADCAST ENGINE
// ==========================================
async function executeBroadcastTask(sock, groupData, textContent, mode, chat, isGodcast, mediaPath, isVideo) {
    const botId = sock.user.id.split(':')[0];
    const jids = groupData.map(g => g.id);
    let finalPayloadText = textContent;

    // 🌸 Auto-wrap the text/link if using godcast and it's a link
    if (isGodcast && finalPayloadText && finalPayloadText.includes('http')) {
        const randomTemplate = AESTHETIC_TEMPLATES[Math.floor(Math.random() * AESTHETIC_TEMPLATES.length)];
        finalPayloadText = randomTemplate(finalPayloadText);
    }

    const jobs = groupData.map(group => ({
        name: `BCAST_${botId}_${group.id}`,
        data: { 
            botId, 
            targetJid: group.id, 
            textContent: finalPayloadText, 
            mode, 
            font: 3, 
            backgroundColor: '#FFB7C5', 
            useGhostProtocol: isGodcast, // 👻 Activates the invisible text delay
            mediaPath,
            isVideo
        },
        opts: { priority: group.size > 100 ? 1 : 3, removeOnComplete: true, removeOnFail: 1000 }
    }));

    for (let i = 0; i < jobs.length; i += 500) {
        try {
            await broadcastQueue.addBulk(jobs.slice(i, i + 500));
            await yieldLoop();
        } catch (error) { logger.error(`[Broadcast] Redis Bulk Add Failed at chunk ${i}: ${error.message}`); }
    }
    
    await sock.sendMessage(chat, { text: `🌸 *ENGINE ENGAGED:* ${jids.length} drops injected into Redis queue.` });
}

module.exports = {
    category: 'BROADCAST',
    commands: [
        { cmd: '.gcast', role: 'public' }, { cmd: '.godcast', role: 'public' }, { cmd: '.stopcast', role: 'public' },
        { cmd: '.schedulecast', role: 'public' }, { cmd: '.schedulegodcast', role: 'public' },
        { cmd: '.loopcast', role: 'public' }, { cmd: '.loopgodcast', role: 'public' },
        { cmd: '.listschedule', role: 'public' }, { cmd: '.cancelschedule', role: 'public' }
    ],
    init: () => {
        if (!fs.existsSync(path.join(__dirname, '../data'))) fs.mkdirSync(path.join(__dirname, '../data'));
        if (fs.existsSync(SCHEDULE_FILE)) {
            try { JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf-8')).forEach(queueSchedule); } catch(e) {}
        }
    },
    
    execute: async ({ sock, msg, args, text, user, botId }) => {
        const chat = msg.key.remoteJid;
        const cmd = text.split(' ')[0].toLowerCase();
        
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const quotedText = quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text || '';

        if (cmd === '.stopcast') { return sock.sendMessage(chat, { text: '🛑 Future payloads aborted.' }); }

        const schedCmds = ['.schedulecast', '.schedulegodcast', '.loopcast', '.loopgodcast'];
        if (schedCmds.includes(cmd)) {
            const timeArg = args.shift();
            const textContent = args.join(' ') || quotedText;
            if (!timeArg || !textContent) return sock.sendMessage(chat, { text: '❌ Usage: .schedulecast 10m Message' });
            
            const time = parseTime(timeArg);
            if (!time) return sock.sendMessage(chat, { text: '❌ Invalid time format. Use m or h (e.g., 15m).' });
            
            const id = 'SCH-' + Math.random().toString(36).slice(2, 8).toUpperCase();
            const isGodcast = cmd.includes('godcast');
            const mode = isGodcast ? 'advanced_status' : 'normal';
            const isLoop = cmd.startsWith('.loop');
            
            queueSchedule({ id, chat, botId, text: textContent, time, mode, isLoop, loopInterval: isLoop ? (time - Date.now()) : null, isGodcast });
            saveSchedules();
            return sock.sendMessage(chat, { text: `📅 Scheduled Drop: ${id}` });
        }

        if (cmd === '.listschedule' || cmd === '.cancelschedule') {
            if (cmd === '.cancelschedule') {
                if (activeSchedules.has(args[0])) { 
                    clearTimeout(activeSchedules.get(args[0]).timeout);
                    activeSchedules.delete(args[0]); 
                    saveSchedules(); 
                    return sock.sendMessage(chat, {text: '🛑 Cancelled.'}); 
                }
                return sock.sendMessage(chat, {text: '❌ Schedule ID not found.'});
            }
            return sock.sendMessage(chat, { text: `📅 Active drops: ${activeSchedules.size}` });
        }

        if (cmd === '.gcast' || cmd === '.godcast') {
            let textContent = args.join(' ') || quotedText;
            
            // 🖼️ MEDIA HANDLING SUPPORT
            let mediaPath = null;
            let isVideo = false;
            const hasMedia = quotedMsg?.imageMessage || quotedMsg?.videoMessage;

            if (hasMedia) {
                try {
                    const ext = quotedMsg.videoMessage ? '.mp4' : '.jpg';
                    isVideo = !!quotedMsg.videoMessage;
                    mediaPath = path.join(TEMP_DIR, `BCAST_${crypto.randomBytes(4).toString('hex')}${ext}`);
                    const buffer = await downloadMediaMessage({ key: msg.key, message: quotedMsg }, 'buffer', { }, { logger: null, reuploadRequest: sock.updateMediaMessage });
                    await fs.promises.writeFile(mediaPath, buffer);
                } catch (mediaErr) { mediaPath = null; }
            }

            if (!textContent && !mediaPath) return sock.sendMessage(chat, { text: '🫪 Payload required.' });
            
            const isGodcast = cmd === '.godcast';
            const groupData = await fetchAllGroups(sock, botId);
            await executeBroadcastTask(sock, groupData, textContent, isGodcast ? 'advanced_status' : 'normal', chat, isGodcast, mediaPath, isVideo);
        }
    }
};
