const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379');

const LIMITS = {
  anon:  parseInt(process.env.RATE_LIMIT_ANON  || '30'),
  user:  parseInt(process.env.RATE_LIMIT_USER  || '200'),
  admin: parseInt(process.env.RATE_LIMIT_ADMIN || '500'),
};

async function rateLimiter(req, res) {
  const role   = req.headers['x-user-role'] || 'anon';
  const limit  = LIMITS[role] || LIMITS.anon;
  const ip     = req.ip || req.socket.remoteAddress;
  const minute = Math.floor(Date.now() / 60000);
  const key    = `rate:${role}:${ip}:${minute}`;

  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 60);

  if (count > limit) {
    res.status(429).setHeader('Retry-After', '60')
       .json({ error: 'Too many requests', retry_after: 60 });
    return true;
  }
  return false;
}

module.exports = { rateLimiter };
