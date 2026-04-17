// core/logger.js
const fs = require('fs');
const path = require('path');

const logDir = path.join(__dirname, '../data/logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

// ==========================
// AESTHETIC COLORS (ANSI)
// ==========================
const colors = {
    reset: "\x1b[0m", bright: "\x1b[1m", dim: "\x1b[2m",
    blue: "\x1b[34m", cyan: "\x1b[36m", green: "\x1b[32m",
    yellow: "\x1b[33m", red: "\x1b[31m", magenta: "\x1b[35m"
};

// ⚡ CPU OPTIMIZATION: Cache the date so we don't recalculate it on every log
let currentDateStr = new Date().toISOString().split('T')[0];
let stream = createStream(currentDateStr);

function createStream(dateStr) {
    const fileName = path.join(logDir, `system-${dateStr}.log`);
    const newStream = fs.createWriteStream(fileName, {
        flags: 'a',
        encoding: 'utf8',
        highWaterMark: 1024 * 64 // 64KB buffer for bulk writes
    });
    
    newStream.on('error', (err) => {
        console.error(`${colors.red}[LOGGER ERROR]${colors.reset} Disk write failed:`, err.message);
    });
    
    return newStream;
}

function writeLog(level, message) {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const time = now.toLocaleTimeString('en-GB', { hour12: false });
    const timestamp = now.toISOString();
    
    let terminalMsg = "";

    // Professional Terminal Formatting
    switch (level) {
        case 'INFO':
            terminalMsg = `${colors.dim}[${time}]${colors.reset} ${colors.cyan}‹ INFO ›${colors.reset} ${message}`;
            break;
        case 'SUCCESS':
            terminalMsg = `${colors.dim}[${time}]${colors.reset} ${colors.green}‹ DONE ›${colors.reset} ${message}`;
            break;
        case 'WARN':
            terminalMsg = `${colors.dim}[${time}]${colors.reset} ${colors.yellow}‹ WARN ›${colors.reset} ${message}`;
            break;
        case 'ERROR':
            terminalMsg = `${colors.dim}[${time}]${colors.reset} ${colors.red}‹ FAIL ›${colors.reset} ${colors.bright}${message}${colors.reset}`;
            break;
        case 'SYSTEM':
            terminalMsg = `${colors.magenta}‹ OMEGA ›${colors.reset} ${colors.bright}${message}${colors.reset}`;
            break;
    }

    console.log(terminalMsg);

    // ⚡ Efficient Daily Rotation Check
    if (dateStr !== currentDateStr) {
        currentDateStr = dateStr;
        stream.end();
        stream = createStream(currentDateStr);
    }

    // Write raw data to file asynchronously
    stream.write(`[${timestamp}] [${level}] ${message}\n`);
}

// Ensure logs flush cleanly if Node exits
process.on('exit', () => { if (stream && !stream.closed) stream.end(); });

module.exports = {
    info: (msg) => writeLog('INFO', msg),
    success: (msg) => writeLog('SUCCESS', msg), 
    warn: (msg) => writeLog('WARN', msg),
    system: (msg) => writeLog('SYSTEM', msg), 
    error: (msg, err = '') => {
        const errorText = err?.stack || err?.message || err;
        writeLog('ERROR', `${msg} ${errorText}`);
    }
};
