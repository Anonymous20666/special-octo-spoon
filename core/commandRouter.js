// core/commandRouter.js
const fs = require('fs');
const path = require('path');
const eventBus = require('./eventBus');
const taskManager = require('./taskManager');
// const rateLimiter = require('../services/rateLimiter'); // DISABLED for high-volume groups
const userEngine = require('../modules/userEngine');
const logger = require('./logger');
const { globalPrefix } = require('../config');

class CommandRouter {
    constructor() {
        this.plugins = new Map();
        this.loadPlugins();
        this.initBus();
    }

    loadPlugins() {
        const dir = path.join(__dirname, '../plugins');
        if (!fs.existsSync(dir)) return;
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
        
        for (const file of files) {
            try {
                const plugin = require(path.join(dir, file));
                
                // Attach boot listeners for plugins that need them (like Intel/Watchdog)
                if (plugin.init) {
                    eventBus.on('system.boot', (sock) => {
                        try { plugin.init(sock); } catch(e) { logger.error(`Init error in ${file}`, e); }
                    });
                }

                // Register every command in the plugin to our RAM cache
                if (plugin.commands && Array.isArray(plugin.commands)) {
                    plugin.commands.forEach(cmd => {
                        this.plugins.set(cmd.cmd.toLowerCase(), {
                            execute: plugin.execute,
                            category: plugin.category,
                            config: cmd, // Stores role, description, etc.
                            file
                        });
                    });
                }
            } catch (err) { logger.error(`Failed to load plugin: ${file}`, err); }
        }
        logger.system(`🚀 Command Router Online: ${this.plugins.size} commands cached.`);
    }

    initBus() {
        eventBus.on('message.upsert', async (payload) => {
            const { sock, msg, text, isGroup, sender, botId, isGroupAdmin } = payload;
            
            // 1. Basic Filters
            if (!text || !text.startsWith(globalPrefix)) return;
            
            // 🚫 BLOCK ALL COMMANDS IN DMs (to prevent bans)
            if (!isGroup) return;

            try {
                // 2. Database Sync (User Clearance)
                const userProfile = await userEngine.getOrCreate(sender, msg.pushName || 'Unknown', isGroupAdmin);
                if (userProfile?.activity?.isBanned) return;

                // 3. Command Parsing
                const args = text.slice(globalPrefix.length).trim().split(/ +/);
                const rawCmd = args.shift().toLowerCase();
                const commandName = `${globalPrefix}${rawCmd}`;

                // 4. Registry Lookup
                const command = this.plugins.get(commandName);
                if (!command || !command.execute) return;

                // 5. Role Verification (SaaS Armor)
                const userRole = userProfile.role || 'public';
                const requiredRole = command.config.role || 'public';
                
                const roles = { 'public': 1, 'admin': 2, 'owner': 3 };
                if ((roles[userRole] || 1) < (roles[requiredRole] || 1)) {
                    return sock.sendMessage(msg.key.remoteJid, { text: `⛔ *Access Denied*\nRequired: ${requiredRole.toUpperCase()}` });
                }

                // 6. Rate Limiting DISABLED for high-volume groups
                // const groupId = isGroup ? msg.key.remoteJid : null;
                // const isAllowed = await rateLimiter.check(sender, groupId);
                // if (!isAllowed) {
                //     return sock.sendMessage(msg.key.remoteJid, { text: '⏳ *Rate limit exceeded. System pacing...*' });
                // }

                // 7. Update Analytics
                await userEngine.recordCommand(sender);

                // 8. Task Manager Submission
                const taskId = `CMD_${sender}_${Date.now()}`;
                taskManager.submit(taskId, async (abortSignal) => {
                    
                    // 🧠 SaaS Detection: Does this plugin expect 1 object or 6 separate arguments?
                    if (command.execute.length === 1) {
                        // Modern Style: execute({ sock, msg, ... })
                        await command.execute({ sock, msg, args, text, user: userProfile, isGroup, botId, abortSignal });
                    } else {
                        // Legacy Style: execute(sock, msg, args, user, commandName, abortSignal)
                        await command.execute(sock, msg, args, userProfile, commandName, abortSignal);
                    }

                }, { priority: 5, timeout: 60000 }).catch(err => {
                    logger.error(`[CRASH PREVENTED] Error in ${commandName}:`, err);
                });

            } catch (error) {
                logger.error(`[CommandRouter] Dispatch Error: ${error.message}`);
            }
        });
    }
}

module.exports = new CommandRouter();
