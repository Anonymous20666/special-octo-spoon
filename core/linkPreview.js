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
        if (!imageUrl || !imageUrl.startsWith('http')) return null;
        
        const res = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            timeout: 8000,
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'image/*'
            },
            maxRedirects: 5
        });
        return Buffer.from(res.data);
    } catch (err) {
        logger.warn(`[LinkPreview] Failed to fetch thumbnail: ${imageUrl}`);
        return null;
    }
}

// ─── FETCH WHATSAPP GROUP INFO ────────
async function fetchWhatsAppGroupInfo(inviteUrl) {
    try {
        const inviteCode = inviteUrl.split('chat.whatsapp.com/')[1]?.split('?')[0];
        if (!inviteCode) return null;

        if (global.waSocks && global.waSocks.size > 0) {
            const sock = global.waSocks.values().next().value;
            if (sock && sock.groupGetInviteInfo) {
                try {
                    const groupInfo = await sock.groupGetInviteInfo(inviteCode);
                    if (groupInfo) {
                        let thumbnail = null;
                        
                        if (groupInfo.id) {
                            try {
                                const ppUrl = await sock.profilePictureUrl(groupInfo.id, 'image');
                                if (ppUrl) thumbnail = await fetchThumbnailBuffer(ppUrl);
                            } catch {}
                        }
                        
                        return {
                            title: groupInfo.subject || 'WhatsApp Group',
                            description: groupInfo.desc || `${groupInfo.size || 0} members`,
                            thumbnail: thumbnail
                        };
                    }
                } catch (err) {
                    logger.warn(`[LinkPreview] Failed to fetch WA group info: ${err.message}`);
                }
            }
        }
        
        return null;
    } catch {
        return null;
    }
}

// ─── CORE ────────────────────────────
async function buildLinkPreview(text, forGroupStatus = false) {
    const urls = extractUrls(text);
    if (!urls.length) return null;

    const url = urls[0];

    // ─── CACHE ───────────────────────
    const cacheKey = forGroupStatus ? `${url}_gs` : url;
    const cached = previewCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }

    // ─── 🎯 PLATFORM PREVIEW FIRST ───
    const platformPreview = getPlatformPreview(url);
    if (platformPreview) {
        let result;
        
        if (forGroupStatus) {
            // Group Status format
            result = {
                url: url,
                title: platformPreview.title,
                description: platformPreview.body,
                thumbnail: await fetchThumbnailBuffer(platformPreview.thumbnailUrl)
            };
        } else {
            // Normal message format - use thumbnailUrl for clickable link
            result = {
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
        }

        previewCache.set(cacheKey, { data: result, timestamp: Date.now() });
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
        // Try to fetch actual group info
        const groupInfo = await fetchWhatsAppGroupInfo(url);
        
        if (forGroupStatus) {
            result = {
                url: url,
                title: groupInfo?.title || "WhatsApp Group",
                description: groupInfo?.description || "Tap to join 💬",
                thumbnail: groupInfo?.thumbnail || null
            };
        } else {
            // For normal messages, use thumbnailUrl if we have it
            let thumbnailUrl = null;
            if (groupInfo?.thumbnail) {
                // We have buffer, but for clickable link we skip thumbnail
                thumbnailUrl = undefined;
            }
            result = {
                externalAdReply: {
                    title: groupInfo?.title || "WhatsApp Group Invite",
                    body: groupInfo?.description || "Tap to join the group 💬",
                    mediaType: 1,
                    sourceUrl: url,
                    renderLargerThumbnail: false,
                    showAdAttribution: false,
                }
            };
        }
    }

    // ─── NORMAL LINKS ────────────────
    if (preview && !result) {
        const thumbnailUrl =
            preview.images?.[0] ||
            preview.favicons?.[0] ||
            null;

        let jpegThumbnail = null;

        // Only fetch buffer for group status
        if (forGroupStatus && thumbnailUrl && thumbnailUrl.startsWith('http')) {
            jpegThumbnail = await fetchThumbnailBuffer(thumbnailUrl);
        }

        if (forGroupStatus) {
            // Group Status format
            result = {
                url: url,
                title: preview.title || preview.siteName || 'Link Preview',
                description: preview.description || '',
                thumbnail: jpegThumbnail
            };
        } else {
            // Normal message format - use thumbnailUrl for clickable link
            result = {
                externalAdReply: {
                    title: preview.title || preview.siteName || 'Link Preview',
                    body: preview.description || '',
                    mediaType: 1,
                    sourceUrl: url,
                    thumbnailUrl: thumbnailUrl || undefined,
                    renderLargerThumbnail: !!thumbnailUrl,
                    showAdAttribution: false,
                }
            };
        }
    }

    // ─── CACHE ───────────────────────
    if (result) {
        previewCache.set(cacheKey, {
            data: result,
            timestamp: Date.now()
        });
    }

    return result;
}

module.exports = { buildLinkPreview, extractUrls };