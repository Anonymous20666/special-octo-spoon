// modules/userEngine.js
const User = require('../core/models/User');
const { ownerWhatsAppJids } = require('../config');
const logger = require('../core/logger');

class UserEngine {
    /**
     * Fetches an existing user or creates a new one in the database.
     * @param {string} userId - The WhatsApp JID of the user.
     * @param {string} name - The pushname or display name.
     * @param {boolean} isGroupAdmin - Whether the user is currently an admin in the context.
     * @returns {Promise<Object>} The user document.
     */
    async getOrCreate(userId, name = 'Unknown', isGroupAdmin = false) {
        if (!userId) return this._fallbackUser();

        try {
            let user = await User.findOne({ userId: userId });

            if (!user) {
                let assignedRole = 'public';
                if (ownerWhatsAppJids && ownerWhatsAppJids.includes(userId)) {
                    assignedRole = 'owner';
                } else if (isGroupAdmin) {
                    assignedRole = 'admin';
                }

                user = await User.create({
                    userId: userId,
                    name: name,
                    role: assignedRole
                });
                logger.info(`👤 New user registered: ${name} (${userId})`);
            } else {
                // 🧠 SaaS Fix: Use atomic updates ($inc) for stats to prevent race conditions during high traffic
                user = await User.findOneAndUpdate(
                    { userId: userId },
                    { 
                        $set: { "activity.lastSeen": Date.now() },
                        $inc: { "stats.messagesSent": 1 }
                    },
                    { new: true } // Returns the updated document
                );
            }

            return user;
        } catch (error) {
            logger.error(`[UserEngine] Database error fetching user ${userId}: ${error.message}`);
            return this._fallbackUser(); // Safe fallback so the bot doesn't crash
        }
    }

    /**
     * Atomically increments the command usage counter for a user.
     * @param {string} userId - The WhatsApp JID.
     */
    async recordCommand(userId) {
        if (!userId) return;
        try {
            await User.updateOne({ userId: userId }, { $inc: { "stats.commandsUsed": 1 } });
        } catch (error) {
            logger.warn(`[UserEngine] Failed to record command for ${userId}`);
        }
    }

    /**
     * Generates a safe fallback user object to prevent crashes if MongoDB goes offline.
     * @private
     */
    _fallbackUser() {
        return { 
            role: 'public', 
            activity: { isBanned: false, lastSeen: Date.now() }, 
            stats: { messagesSent: 0, commandsUsed: 0 } 
        };
    }
}

module.exports = new UserEngine();
