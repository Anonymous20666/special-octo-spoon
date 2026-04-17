// core/database.js
const mongoose = require('mongoose');
const logger = require('./logger');
require('dotenv').config();

async function connectDB() {
    try {
        // Connect to MongoDB using the URI from our .env file
        await mongoose.connect(process.env.MONGO_URI);
        logger.system('🟢 [DATABASE] MongoDB Fortress is ONLINE and securely connected.');
    } catch (error) {
        logger.error('🚨 [DATABASE] Critical failure connecting to MongoDB:', error.message);
        // We exit the process here because the bot cannot function without its database
        process.exit(1); 
    }
}

module.exports = { connectDB };
