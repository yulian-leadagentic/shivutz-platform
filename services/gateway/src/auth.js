const jwt    = require('jsonwebtoken');
const Redis  = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379');
const SECRET = process.env.JWT_SECRET;
const CACHE_TTL = 300; // 5 minutes

async function validateToken(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  // Redis cache: avoid hitting auth service on every request
  const cacheKey = `token:${token.slice(-16)}`; // last 16 chars as key
  const cached   = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  // Blocklist check
  const blocked = await redis.get(`blocklist:${token}`);
  if (blocked) return null;

  try {
    const decoded = jwt.verify(token, SECRET);
    await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(decoded));
    return decoded;
  } catch {
    return null;
  }
}

module.exports = { validateToken };
