const Redis = require('ioredis');
const client = new Redis(process.env.REDIS_URL || 'redis://redis:6379');
client.on('error', err => console.error('Redis error:', err));
module.exports = client;
