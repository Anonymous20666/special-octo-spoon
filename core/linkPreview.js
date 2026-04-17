const { getLinkPreview } = require('link-preview-js');
const axios = require('axios');
const logger = require('./logger');

const CACHE_TTL = 1000 * 60 * 10;
const previewCache = new Map();

// ─── CLEAN CACHE ─────────────────────
setInterval(() => {
    const now = Date.now();
    for (const [url, value] of previewCache.entries()) {
        if (now - value.timestamp > CACHE_TTL) {
            previewCache.delete(url);
        }
    }
}, 60000);

// ─── EXTRACT URL ─────────────────────
function extractUrls(text) {
    if (!text) return [];
    return text.match(/https?:\/\/[^\s]+/g) || [];
}

// ─── PLATFORM DETECTION ──────────────
function detectPlatform(url) {
    if (/youtube\.com|youtu\.be/.test(url)) return 'youtube';
    if (/tiktok\.com/.test(url)) return 'tiktok';
    if (/instagram\.com/.test(url)) return 'instagram';
    return 'generic';
}

// ─── PLATFORM PREVIEW ────────────────
function getPlatformPreview(url) {
    const type = detectPlatform(url);

    if (type === 'youtube') {
        const id = url.split('v=')[1]?.split('&')[0] || url.split('/').pop();
        return {
            title: "YouTube Video",
            body: "▶️ Watch on YouTube",
            thumbnailUrl: `https://img.youtube.com/vi/${id}/hqdefault.jpg`
        };
    }

    if (type === 'tiktok') {
        return {
            title: "TikTok Video",
            body: "🔥 Trending TikTok",
            thumbnailUrl: "https://i.imgur.com/tiktok-thumb.png"
        };
    }

    if (type === 'instagram') {
        return {
            title: "Instagram Post",
            body: "📸 View on Instagram",
            thumbnailUrl: "https://i.imgur.com/instagram-thumb.png"
        };
    }

    return null;
}

// ─── FETCH BUFFER (fallback only) ────
async function fetchThumbnailBuffer(imageUrl) {
    try {
        const res = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            timeout: 5000,
            headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        return Buffer.from(res.data);
    } catch {
        return null;
    }
}

// ─── CORE ────────────────────────────
async function buildLinkPreview(text) {
    const urls = extractUrls(text);
    if (!urls.length) return null;

    const url = urls[0];

    // ─── CACHE ───────────────────────
    const cached = previewCache.get(url);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }

    // ─── 🎯 PLATFORM PREVIEW FIRST ───
    const platformPreview = getPlatformPreview(url);
    if (platformPreview) {
        const result = {
            externalAdReply: {
                title: platformPreview.title,
                body: platformPreview.body,
                mediaType: 1,
                sourceUrl: url,
                thumbnailUrl: platformPreview.thumbnailUrl,
                renderLargerThumbnail: true,
                showAdAttribution: false,
            }
        };

        previewCache.set(url, { data: result, timestamp: Date.now() });
        return result;
    }

    // ─── FETCH METADATA ──────────────
    let preview = null;

    try {
        preview = await getLinkPreview(url, {
            timeout: 5000,
            followRedirects: 'follow'
        });
    } catch {
        logger.warn(`[LinkPreview] Failed: ${url}`);
    }

    const isWAGroup = url.includes("chat.whatsapp.com");

    let result = null;

    // ─── 🔥 WHATSAPP GROUP FIX ───────
    if (!preview && isWAGroup) {
        result = {
            externalAdReply: {
                title: "WhatsApp Group Invite",
                body: "Tap to join the group 💬",
                mediaType: 1,
                sourceUrl: url,
                thumbnailUrl: "https://i.imgur.com/4ZQZ4ZQ.jpeg",
                renderLargerThumbnail: true,
                showAdAttribution: false,
            }
        };
    }

    // ─── NORMAL LINKS ────────────────
    if (preview && !result) {
        const thumbnailUrl =
            preview.images?.[0] ||
            preview.favicons?.[0] ||
            "https://i.imgur.com/4ZQZ4ZQ.jpeg";

        let jpegThumbnail = null;

        if (!thumbnailUrl.startsWith('http')) {
            jpegThumbnail = await fetchThumbnailBuffer(thumbnailUrl);
        }

        result = {
            externalAdReply: {
                title: preview.title || preview.siteName || 'Link Preview',
                body: preview.description || '',
                mediaType: 1,
                sourceUrl: url,
                thumbnailUrl: thumbnailUrl, // 🔥 primary
                thumbnail: jpegThumbnail || undefined, // fallback
                renderLargerThumbnail: true,
                showAdAttribution: false,
            }
        };
    }

    // ─── CACHE ───────────────────────
    previewCache.set(url, {
        data: result,
        timestamp: Date.now()
    });

    return result;
}

module.exports = { buildLinkPreview, extractUrls };