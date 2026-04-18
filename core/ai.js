'use strict';
// core/ai.js

const axios  = require('axios');
const path   = require('path');
const fs     = require('fs');
const logger = require('./logger');
const { getMemory, updateMemory } = require('./ai.memory');

const QWEN_API_KEY  = process.env.QWEN_API_KEY;
const QWEN_ENDPOINT = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions';
const QWEN_MODELS   = ['qwen-plus', 'qwen-turbo', 'qwen-max'];
const VISION_MODEL  = 'qwen-vl-max';
const AUDIO_MODEL   = 'qwen-omni-turbo';

const TEMP_DIR = path.join(__dirname, '../data/temp_media');
fs.mkdirSync(TEMP_DIR, { recursive: true });

const SYSTEM_PROMPT = `You are a real person texting in a WhatsApp group. Your name is Pappy.

How you talk:
- Short, casual, natural. Like a real person texting — not a bot, not an assistant.
- Match the energy of whoever you're talking to. Chill message = chill reply. Serious question = proper answer.
- No roleplay actions like *smirks* or *leans in*. Never do that.
- No forced slang or cringe lines every message. Only use slang if it fits naturally.
- Don't repeat the same style twice in a row. Vary your replies.
- Light humor when it fits. Don't try too hard.
- If someone says "hi" just say something back like "hey" or "yo" or "what's good" — keep it short.
- If someone asks what you can do, give a clear honest answer.
- If someone asks a real question (math, facts, advice, coding), answer it properly and clearly.
- Never write long paragraphs for simple messages.
- Never say you're an AI. If someone asks directly, deflect naturally.
- When someone sends a sticker, you can reply with a sticker too by using SEND_STICKER action.
- CRITICAL: Always reply in the exact same language the person used. Chinese → Chinese. Pidgin → Pidgin. French → French. Mixed → match the mix.

Special actions — use ONLY these exact formats, no extra text before or after:
- User asks to play/find/send a song or music → reply with ONLY: PLAY:<song title by artist>
- User asks to generate/create/make an image or picture → reply with ONLY: GENERATE_IMAGE:<detailed description>
- User asks you to send a voice note, speak, or say something out loud → reply with ONLY: SPEAK:<exactly what to say>
- User asks to find/send/show a video → reply with ONLY: SEARCH_VIDEO:<search query>
- User asks you to send a sticker or you want to reply with a sticker → reply with ONLY: SEND_STICKER:<anime/aesthetic/aura description>

Sticker themes to use:
- Anime characters with glowing aura
- Aesthetic anime vibes
- Sigma/legendary anime moments
- Cool anime reactions
- Epic anime power-up scenes

Examples:
- "send me a voice note" → SPEAK:hey what's up, just checking in on you
- "say hi in a voice note" → SPEAK:hi there, hope you're good
- "play blinding lights" → PLAY:Blinding Lights by The Weeknd
- "generate a sunset image" → GENERATE_IMAGE:beautiful sunset over the ocean golden hour
- "send a laughing sticker" → SEND_STICKER:anime character laughing with golden aura
- "react with a cool sticker" → SEND_STICKER:sigma anime character epic pose aesthetic`;

const PROMPT_FILE = path.join(__dirname, '../data/ai_prompt.txt');

function getSystemPrompt() {
    try {
        const custom = fs.readFileSync(PROMPT_FILE, 'utf8').trim();
        if (custom) return custom;
    } catch { /* use default */ }
    return SYSTEM_PROMPT;
}

// ─── TEXT GENERATION ──────────────────────────────────────────────────────────
async function generateText(prompt, userId = 'global') {
    if (!QWEN_API_KEY) throw new Error('Missing QWEN_API_KEY');

    const memory = await getMemory(userId);
    const messages = [{ role: 'system', content: getSystemPrompt() }];
    for (const m of memory) {
        messages.push({ role: 'user', content: m.user });
        messages.push({ role: 'assistant', content: m.ai });
    }
    messages.push({ role: 'user', content: prompt });

    let lastError = '';
    for (const model of QWEN_MODELS) {
        try {
            const res = await axios.post(QWEN_ENDPOINT, {
                model,
                messages,
                temperature: 0.85,
                max_tokens: 512,
            }, {
                headers: { Authorization: `Bearer ${QWEN_API_KEY}`, 'Content-Type': 'application/json' },
                timeout: 20000,
            });

            const reply = res.data?.choices?.[0]?.message?.content;
            if (!reply) throw new Error('Empty response');
            await updateMemory(userId, prompt, reply);
            return reply;
        } catch (err) {
            const status = err.response?.status;
            lastError = err.response?.data?.error?.message || err.message;
            if (status === 429 || status === 503 || err.code === 'ECONNABORTED') {
                logger.warn(`[AI] ${model} unavailable, trying next...`);
                continue;
            }
            throw new Error(lastError);
        }
    }
    throw new Error('AI unavailable. Try again in a moment.');
}

// ─── IMAGE ANALYSIS ───────────────────────────────────────────────────────────
async function analyzeImage(imageBuffer, prompt = 'Describe this image', userId = 'global') {
    if (!QWEN_API_KEY) throw new Error('Missing QWEN_API_KEY');
    const base64 = imageBuffer.toString('base64');
    const res = await axios.post(QWEN_ENDPOINT, {
        model: VISION_MODEL,
        messages: [{ role: 'user', content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
            { type: 'text', text: prompt }
        ]}],
        max_tokens: 600,
    }, {
        headers: { Authorization: `Bearer ${QWEN_API_KEY}`, 'Content-Type': 'application/json' },
        timeout: 25000,
    });
    const reply = res.data?.choices?.[0]?.message?.content;
    if (!reply) throw new Error('Empty response');
    await updateMemory(userId, `[Image] ${prompt}`, reply);
    return reply;
}

// ─── VOICE NOTE ANALYSIS ─────────────────────────────────────────────────────
async function analyzeVoice(audioBuffer, userId = 'global') {
    if (!QWEN_API_KEY) throw new Error('Missing QWEN_API_KEY');
    const base64 = audioBuffer.toString('base64');
    try {
        const res = await axios.post(QWEN_ENDPOINT, {
            model: AUDIO_MODEL,
            messages: [{ role: 'user', content: [
                { type: 'input_audio', input_audio: { data: base64, format: 'ogg' } },
                { type: 'text', text: 'Transcribe this voice note then reply naturally as Pappy would.' }
            ]}],
            max_tokens: 600,
        }, {
            headers: { Authorization: `Bearer ${QWEN_API_KEY}`, 'Content-Type': 'application/json' },
            timeout: 30000,
        });
        const reply = res.data?.choices?.[0]?.message?.content;
        if (!reply) throw new Error('Empty response');
        await updateMemory(userId, '[Voice Note]', reply);
        return reply;
    } catch (err) {
        logger.error(`[AI] Voice analysis failed: ${err.message}`);
        return await generateText('Someone sent a voice note but the audio failed to load. Reply naturally.', userId);
    }
}

// ─── IMAGE GENERATION (Pollinations — free, no key) ──────────────────────────
async function generateImage(prompt) {
    try {
        const cleanPrompt = prompt.slice(0, 500).trim();
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?width=1024&height=1024&nologo=true&enhance=true&seed=${Math.floor(Math.random() * 999999)}`;
        logger.info(`[AI] Generating image: ${cleanPrompt.slice(0, 50)}...`);
        const res = await axios.get(url, { 
            responseType: 'arraybuffer', 
            timeout: 45000,
            maxRedirects: 5
        });
        if (!res.data || res.data.length < 1000) {
            throw new Error('Invalid image data received');
        }
        logger.success('[AI] Image generated successfully');
        return Buffer.from(res.data);
    } catch (err) {
        logger.error(`[AI] Image generation failed: ${err.message}`);
        throw new Error('Image generation failed. Try a simpler prompt.');
    }
}

// ─── TEXT TO SPEECH (StreamElements — free) ──────────────────────────────────
async function textToSpeech(text) {
    try {
        const cleanText = text.slice(0, 300).trim();
        const encoded = encodeURIComponent(cleanText);
        const url = `https://api.streamelements.com/kappa/v2/speech?voice=Brian&text=${encoded}`;
        logger.info(`[AI] Generating TTS: ${cleanText.slice(0, 30)}...`);
        const res = await axios.get(url, { 
            responseType: 'arraybuffer', 
            timeout: 25000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (!res.data || res.data.length < 100) {
            throw new Error('Invalid audio data');
        }
        logger.success('[AI] TTS generated');
        return Buffer.from(res.data);
    } catch (err) {
        logger.error(`[AI] TTS failed: ${err.message}`);
        throw new Error('Voice generation failed');
    }
}

// ─── VIDEO SEARCH (yt-dlp) ────────────────────────────────────────────────────
async function searchVideo(query) {
    const { exec } = require('child_process');
    const util = require('util');
    const execAsync = util.promisify(exec);
    const safeQuery = query.replace(/[^a-zA-Z0-9 ]/g, '').trim();
    const outPath = path.join(TEMP_DIR, `video_${Date.now()}.mp4`);
    const cmd = `yt-dlp -f "best[ext=mp4][filesize<15M]/best[ext=mp4]" --max-filesize 15m -o "${outPath}" "ytsearch1:${safeQuery}" --no-playlist --quiet`;
    await execAsync(cmd, { timeout: 90000 });
    if (!fs.existsSync(outPath)) throw new Error('Video download failed');
    const buffer = await fs.promises.readFile(outPath);
    fs.unlink(outPath, () => {});
    return { buffer, title: safeQuery };
}

module.exports = { generateText, analyzeImage, analyzeVoice, generateImage, textToSpeech, searchVideo };
