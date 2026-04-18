'use strict';
// plugins/pappy-sticker.js

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const logger = require('../core/logger');

const execAsync = promisify(exec);
const TEMP_DIR = path.join(__dirname, '../data/temp_media');

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

async function imageToSticker(inputBuffer) {
    const inputPath = path.join(TEMP_DIR, `sticker_in_${Date.now()}.png`);
    const outputPath = path.join(TEMP_DIR, `sticker_out_${Date.now()}.webp`);
    
    try {
        fs.writeFileSync(inputPath, inputBuffer);
        
        // Convert to webp sticker format (512x512)
        await execAsync(`ffmpeg -i "${inputPath}" -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white@0.0" -vcodec libwebp -lossless 1 -q:v 90 -preset default -loop 0 -an -vsync 0 "${outputPath}"`, { timeout: 15000 });
        
        const stickerBuffer = fs.readFileSync(outputPath);
        
        // Cleanup
        fs.unlinkSync(inputPath);
        fs.unlinkSync(outputPath);
        
        return stickerBuffer;
    } catch (err) {
        logger.error(`[Sticker] Conversion failed: ${err.message}`);
        // Cleanup on error
        try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch {}
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
        throw err;
    }
}

module.exports = {
    category: 'MEDIA',
    commands: [
        { cmd: '.sticker', role: 'public' },
        { cmd: '.s', role: 'public' }
    ],

    execute: async ({ sock, msg, args, text }) => {
        const jid = msg.key.remoteJid;
        
        // Check for quoted image/video
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const imageMsg = msg.message?.imageMessage || quotedMsg?.imageMessage;
        const videoMsg = msg.message?.videoMessage || quotedMsg?.videoMessage;
        
        if (!imageMsg && !videoMsg) {
            return sock.sendMessage(jid, { 
                text: '❌ Reply to an image or video with .sticker or .s' 
            }, { quoted: msg });
        }
        
        try {
            const { downloadMediaMessage } = require('gifted-baileys');
            
            const processing = await sock.sendMessage(jid, { 
                text: '⏳ Creating sticker...' 
            }, { quoted: msg });
            
            let mediaBuffer;
            if (imageMsg) {
                const imgMsg = msg.message?.imageMessage 
                    ? msg 
                    : { key: msg.key, message: quotedMsg };
                mediaBuffer = await downloadMediaMessage(imgMsg, 'buffer', {}, { 
                    logger: null, 
                    reuploadRequest: sock.updateMediaMessage 
                });
            } else {
                // For video, extract first frame
                const vidMsg = msg.message?.videoMessage 
                    ? msg 
                    : { key: msg.key, message: quotedMsg };
                const videoBuffer = await downloadMediaMessage(vidMsg, 'buffer', {}, { 
                    logger: null, 
                    reuploadRequest: sock.updateMediaMessage 
                });
                
                // Extract first frame from video
                const videoPath = path.join(TEMP_DIR, `video_${Date.now()}.mp4`);
                const framePath = path.join(TEMP_DIR, `frame_${Date.now()}.png`);
                
                fs.writeFileSync(videoPath, videoBuffer);
                await execAsync(`ffmpeg -i "${videoPath}" -vframes 1 "${framePath}"`, { timeout: 10000 });
                mediaBuffer = fs.readFileSync(framePath);
                
                fs.unlinkSync(videoPath);
                fs.unlinkSync(framePath);
            }
            
            const stickerBuffer = await imageToSticker(mediaBuffer);
            
            await sock.sendMessage(jid, { 
                sticker: stickerBuffer 
            }, { quoted: msg });
            
            // Delete processing message
            await sock.sendMessage(jid, { delete: processing.key }).catch(() => {});
            
        } catch (err) {
            logger.error(`[Sticker] Error: ${err.message}`);
            return sock.sendMessage(jid, { 
                text: `❌ Failed to create sticker: ${err.message}` 
            }, { quoted: msg });
        }
    }
};
