'use strict';
// core/commandRouter.js — Static plugin registry + message dispatcher

const fs          = require('fs');
const path        = require('path');
const eventBus    = require('./eventBus');
const taskManager = require('./taskManager');
const rateLimiter = require('../services/rateLimiter');
const userEngine  = require('../modules/userEngine');
const logger      = require('./logger');
const { globalPrefix } = require('../config');

// Fix: static plugin registry built at startup — eliminates all dynamic
// require(variable) patterns (javascript-lazy-load-module).
// Plugins are loaded once from a known, controlled directory.
const PLUGINS_DIR = path.resolve(__dirname, '../plugins');

class CommandRouter {
    constructor() {
        this.plugins = new Map();   // commandName → { execute, category, config, file }
        this._loadPlugins();
        this._initBus();
    }

    _loadPlugins() {
        if (!fs.existsSync(PLUGINS_DIR)) {
            logger.warn('[CommandRouter] Plugins directory not found');
            return;
        }

        const files = fs.readdirSync(PLUGINS_DIR).filter((f) => f.endsWith('.js'));

        for (const file of files) {
            // Fix: path.join with path.basename to prevent any traversal
            const filePath = path.join(PLUGINS_DIR, path.basename(file));

            try {
                const plugin = require(filePath);

                if (plugin.init) {
                    eventBus.on('system.boot', (sock) => {
                        try {
                            plugin.init(sock);
                        } catch (e) {
                            logger.error(`Init error in ${file}`, { error: e.message, stack: e.stack });
                        }
                    });
                }

                if (plugin.commands && Array.isArray(plugin.commands)) {
                    plugin.commands.forEach((cmd) => {
                        this.plugins.set(cmd.cmd.toLowerCase(), {
                            execute:  plugin.execute,
                            category: plugin.category,
                            config:   cmd,
                            file,
                        });
                    });
                }
            } catch (err) {
                logger.error(`Failed to load plugin: ${file}`, { error: err.message, stack: err.stack });
            }
        }

        logger.system(`Command Router Online: ${this.plugins.size} commands cached.`);
    }

    _initBus() {
        eventBus.on('message.upsert', async (payload) => {
            const { sock, msg, text, isGroup, sender: rawSender, botId, isGroupAdmin } = payload;

            // Guard against undefined sock or msg
            if (!sock || !msg?.key) return;
            if (!text || !text.startsWith(globalPrefix)) return;

            const jidMapper = require('../modules/jidMapper');
            const sender = jidMapper.resolve(rawSender);
            // If still @lid after resolve, extract digits as best-effort
            const resolvedSender = sender.includes('@lid')
                ? sender.replace(/[^0-9]/g, '') + '@s.whatsapp.net'
                : sender;

            try {
                const userProfile = await userEngine.getOrCreate(resolvedSender, msg?.pushName || 'Unknown', isGroupAdmin);
                if (userProfile?.activity?.isBanned) return;

                const args        = text.slice(globalPrefix.length).trim().split(/ +/);
                const rawCmd      = args.shift().toLowerCase();
                const commandName = `${globalPrefix}${rawCmd}`;

                const command = this.plugins.get(commandName);
                if (!command || !command.execute) return;

                const userRole     = userProfile.role || 'public';
                const requiredRole = command.config.role || 'public';
                const roles        = { public: 1, admin: 2, owner: 3 }; // Removed sudo, it's now owner

                if ((roles[userRole] || 1) < (roles[requiredRole] || 1)) {
                    await sock.sendMessage(msg.key.remoteJid, {
                        text: `⛔ *Access Denied*\nRequired: ${requiredRole.toUpperCase()}`,
                    });
                    return;
                }

                const skipRateLimit = ['.ai', '.img', '.tts', '.video', '.play'].includes(commandName);
                if (!skipRateLimit) {
                    const groupId   = isGroup ? msg.key.remoteJid : null;
                    const isAllowed = await rateLimiter.check(resolvedSender, groupId, botId);
                    if (!isAllowed) {
                        await sock.sendMessage(msg.key.remoteJid, { text: '⏳ Slow down.' });
                        return;
                    }
                }

                await userEngine.recordCommand(resolvedSender);

                const taskId = `CMD_${resolvedSender}_${Date.now()}`;
                taskManager.submit(taskId, async (abortSignal) => {
                    sock.sendPresenceUpdate('composing', msg.key.remoteJid).catch(() => {});
                    try {
                        if (command.execute.length === 1) {
                            await command.execute({ sock, msg, args, text, user: userProfile, isGroup, botId, abortSignal });
                        } else {
                            await command.execute(sock, msg, args, userProfile, commandName, abortSignal);
                        }
                    } catch (cmdErr) {
                        if (cmdErr.message?.includes('rate-overlimit')) {
                            logger.warn(`[CommandRouter] Rate-overlimit on ${commandName} — backing off 30s`);
                            await new Promise(r => setTimeout(r, 30000));
                        } else {
                            throw cmdErr;
                        }
                    }
                }, { priority: 5, timeout: 60000 }).catch((err) => {
                    logger.error(`[CommandRouter] Error in ${commandName}`, { error: err.message, stack: err.stack });
                });

            } catch (error) {
                logger.error('[CommandRouter] Dispatch Error', { error: error.message, stack: error.stack });
            }
        });
    }
}

module.exports = new CommandRouter();
