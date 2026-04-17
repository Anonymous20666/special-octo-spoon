// services/redis.js
const { Redis } = require('ioredis');
const { redis } = require('../config'); // 👈 This links to your central config.js

const redisConfig = {
    host: redis.host,
    port: redis.port,
    password: redis.password, // 👈 This now correctly grabs your .env password!
    maxRetriesPerRequest: null, // Required by BullMQ
};

const connection = new Redis(redisConfig);

module.exports = { connection };
