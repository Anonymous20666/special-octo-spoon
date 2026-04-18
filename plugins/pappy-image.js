// plugins/pappy-image.js
// Anime Image Generator using Waifu APIs

const ai = require('../core/ai');
const logger = require('../core/logger');

module.exports = {
    category: 'AI',
    commands: [
        {
            cmd: '.img',
            desc: 'Generate anime images (waifus, isekai characters)',
            role: 'public',
            execute: async ({ sock, msg, args, text }) => {
                const jid = msg.key.remoteJid;
                
                if (args.length === 0) {
                    await sock.sendMessage(jid, { 
                        text: '❌ Usage: .img <description>\n\nExample: .img cool anime warrior with glowing sword' 
                    }, { quoted: msg });
                    return;
                }

                const prompt = args.join(' ');
                
                try {
                    await sock.sendPresenceUpdate('composing', jid);
                    
                    const imgBuffer = await Promise.race([
                        ai.generateImage(prompt),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000))
                    ]);
                    
                    await sock.sendMessage(jid, { 
                        image: imgBuffer, 
                        caption: `🎨 Generated: ${prompt}` 
                    }, { quoted: msg });
                    
                    logger.success(`[IMG] Generated for: ${prompt}`);
                } catch (err) {
                    logger.error(`[IMG] Failed: ${err.message}`);
                    await sock.sendMessage(jid, { 
                        text: '❌ Failed to generate image. Try again.' 
                    }, { quoted: msg });
                }
            }
        }
    ]
};
