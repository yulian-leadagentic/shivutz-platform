const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379');

// Gateway projects entity_type → x-user-role (see attachUserHeaders
// in index.js), so authenticated users arrive here with role
// 'contractor' / 'corporation' rather than the generic 'user'. Both
// share the same per-minute budget as 'user' — they're the same
// kind of caller from a rate-limit POV. Keeping 'user' as an alias
// for anything we add later that legitimately needs that bucket.
const LIMITS = {
  anon:        parseInt(process.env.RATE_LIMIT_ANON  || '30'),
  user:        parseInt(process.env.RATE_LIMIT_USER  || '200'),
  contractor:  parseInt(process.env.RATE_LIMIT_USER  || '200'),
  corporation: parseInt(process.env.RATE_LIMIT_USER  || '200'),
  admin:       parseInt(process.env.RATE_LIMIT_ADMIN || '500'),
};

// Paths the gateway-level rate limiter should NOT count. The auth
// service has its own per-phone + per-IP throttle on the OTP-send
// flow that's tuned for abuse-prevention there; double-counting at
// the gateway just blocks legitimate users mid-login when they're
// still anonymous. Anything else under /api/auth/* is also
// pass-through (refresh, select-entity, memberships) — same idea.
const EXEMPT_PATH_PREFIXES = ['/api/auth/'];

function isExempt(req) {
  // CORS preflights are browser overhead, not "real" API calls —
  // they don't carry credentials or trigger meaningful work, so
  // they shouldn't burn the user's per-minute budget.
  if (req.method === 'OPTIONS') return true;
  for (const p of EXEMPT_PATH_PREFIXES) {
    if (req.path.startsWith(p)) return true;
  }
  return false;
}

async function rateLimiter(req, res) {
  if (isExempt(req)) return false;

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
