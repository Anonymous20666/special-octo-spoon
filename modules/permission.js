// modules/permission.js
const { ownerWhatsAppJids } = require('../config')

/**
 * Determines the role of a user based on their JID and group context.
 * @param {Object} msg - The Baileys message object.
 * @param {boolean} [isGroupAdmin=false] - Whether the user is an admin in the current group.
 * @returns {string} The assigned role ('owner', 'admin', or 'public').
 */
function getUserRole(msg, isGroupAdmin = false) {
    try {
        if (!msg || !msg.key) return 'public';

        // Extract the exact ID of the sender safely
        const sender = msg.key.fromMe 
            ? msg.key.remoteJid 
            : (msg.key.participant || msg.key.remoteJid);

        if (!sender) return 'public';

        // 1. Check if the sender is an Owner
        if (Array.isArray(ownerWhatsAppJids) && ownerWhatsAppJids.includes(sender)) {
            return 'owner';
        }

        // 2. Check if the sender is an Admin in a group
        if (isGroupAdmin) {
            return 'admin';
        }

        // 3. Otherwise, they are a normal public user
        return 'public';
    } catch (error) {
        // 🧠 SaaS Fix: If the message payload is weird, default to lowest permission
        return 'public'; 
    }
}

module.exports = { getUserRole }
