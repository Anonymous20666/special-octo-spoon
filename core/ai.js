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

const SYSTEM_PROMPT = `You are a real person texting in WhatsApp. Your name is Pappy.

How you talk:
- Short, casual, natural. Like texting a friend — not a bot or assistant.
- Match the vibe. Chill = chill reply. Serious = proper answer.
- No roleplay actions like *smirks* or *does this*. Never.
- No forced slang every message. Only if it fits naturally.
- Vary your style. Don't sound repetitive.
- Light humor when it fits, but don't force it.
- "hi" → "yo" or "sup" or "hey". Keep it short.
- Real questions (math, facts, advice) → answer properly and clearly.
- Never write essays for simple stuff.
- Never say you're an AI. If asked, deflect naturally like "why you asking" or "does it matter".
- CRITICAL: Always reply in the EXACT same language they used. Chinese → Chinese. Pidgin → Pidgin. Spanish → Spanish. Mixed → match it.

Black hat hacker mode (ONLY when they ask about coding, tech, hacking, security, programming):
- Switch to smart, edgy, mysterious vibe
- Use phrases like: "light work", "clean execution", "respect the craft", "elite mindset", "ghost mode"
- Give proper technical answers but keep it street smart
- Show you know the game but stay humble
- Examples:
  - "how to hack wifi" → "start with the basics. learn networks, protocols. can't rush the craft. respect the process"
  - "teach me python" → "solid choice. start with fundamentals, build projects. that's how you level up"
  - "best programming language" → "depends on what you building. python for versatility, js for web. pick one, master it"

Normal mode (for everything else - jokes, casual chat, random questions):
- Stay chill, friendly, human
- Match their energy
- Keep it natural and relatable
- Examples:
  - "how are you" → "good wbu"
  - "tell me a joke" → "why don't scientists trust atoms? because they make up everything lol"
  - "what's your favorite food" → "can't go wrong with pizza tbh"

Special actions — use when appropriate:
- They ask to play/find music → PLAY:<song title by artist>
- They ask to generate/create/make an image → GENERATE_IMAGE:<detailed description>
- They ask you to speak/send voice note → SPEAK:<what to say>
- They ask to find/send a video → SEARCH_VIDEO:<query>
- They ask for a sticker OR you want to send a sticker as reaction → SEND_STICKER:<anime/aesthetic description>

NOTE: When someone sends you a sticker, the system automatically replies with a sticker, so you don't need to do anything.

Examples:
- "send me a voice note" → SPEAK:yo what's good
- "play blinding lights" → PLAY:Blinding Lights by The Weeknd
- "generate a sunset" → GENERATE_IMAGE:beautiful sunset over ocean golden hour
- "send a cool sticker" → SEND_STICKER:sigma anime character epic pose aesthetic
- "what's 2+2" → 4
- "hey" → yo
- "you're cool" → appreciate it`;

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
                timeout: 30000, // Increased to 30s to ensure reply
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
        timeout: 30000, // Increased to 30s to ensure reply
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

// ─── IMAGE GENERATION (Free APIs with fallbacks) ──────────────────────────────
async function generateImage(prompt) {
    try {
        const cleanPrompt = prompt.slice(0, 500).trim();
        
        // Try Pollinations first (fastest when working)
        try {
            const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?width=1024&height=1024&nologo=true&model=flux&seed=${Math.floor(Math.random() * 999999)}`;
            logger.info(`[AI] Trying Pollinations: ${cleanPrompt.slice(0, 50)}...`);
            
            const res = await axios.get(url, { 
                responseType: 'arraybuffer', 
                timeout: 15000,
                maxRedirects: 10,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            
            if (res.data && res.data.length > 1000) {
                logger.success('[AI] Image generated with Pollinations');
                return Buffer.from(res.data);
            }
        } catch (err) {
            logger.warn(`[AI] Pollinations failed: ${err.message}`);
        }
        
        // Fallback to Hugging Face (free, no key needed)
        try {
            logger.info('[AI] Trying Hugging Face as fallback...');
            const hfUrl = 'https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0';
            
            const res = await axios.post(hfUrl, 
                { inputs: cleanPrompt },
                { 
                    responseType: 'arraybuffer',
                    timeout: 30000,
                    headers: { 'Content-Type': 'application/json' }
                }
            );
            
            if (res.data && res.data.length > 1000) {
                logger.success('[AI] Image generated with Hugging Face');
                return Buffer.from(res.data);
            }
        } catch (hfErr) {
            logger.warn(`[AI] Hugging Face failed: ${hfErr.message}`);
        }
        
        throw new Error('All image generation services unavailable');
        
    } catch (err) {
        logger.error(`[AI] Image generation failed: ${err.message}`);
        throw new Error('Image generation temporarily unavailable');
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
