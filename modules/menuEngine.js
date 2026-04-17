// modules/menuEngine.js

const fs = require('fs');
const path = require('path');

function generateMenu(userRole) {
    const pluginsDir = path.join(__dirname, '../plugins');
    const files = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.js'));

    let menuMap = {};

    files.forEach(file => {
        try {
            const plugin = require(path.join(pluginsDir, file));

            // If a file doesn't have commands, skip it
            if (!plugin.commands) return;

            // FIX: If a plugin doesn't have a category, put it in 'GENERAL' instead of hiding it
            const category = plugin.category ? plugin.category.toUpperCase() : 'GENERAL';

            if (!menuMap[category]) {
                menuMap[category] = [];
            }

            plugin.commands.forEach(command => {
                if (hasPermission(userRole, command.role)) {
                    menuMap[category].push(command.cmd);
                }
            });

        } catch (e) {
            console.log("Menu plugin load error:", file, e.message);
        }
    });

    return formatMenu(menuMap, userRole);
}

function hasPermission(userRole, requiredRole = 'owner') {
    if (userRole === "owner") return true;
    if (userRole === "admin" && (requiredRole === "admin" || requiredRole === "public")) return true;
    if (userRole === "public" && requiredRole === "public") return true;
    return false;
}

function formatMenu(menuMap, userRole) {
    let menuText = "╔════════════════════╗\n";
    menuText += "   Ω ELITE MENU\n";
    menuText += "╚════════════════════╝\n";
    menuText += `👤 Access Level: *${userRole.toUpperCase()}*\n\n`;

    for (const category in menuMap) {
        const commands = menuMap[category];
        
        // Skip empty categories
        if (commands.length === 0) continue;

        // Clean WhatsApp markdown formatting
        menuText += `╭─❑ *${category}* ❑\n`;
        
        commands.forEach(cmd => {
            menuText += `│ • ${cmd}\n`;
        });
        
        menuText += `╰─────────────────\n\n`;
    }

    // Add a cool footer
    menuText += "> Powered by Elite Engine";

    return menuText.trim();
}

module.exports = { generateMenu };
