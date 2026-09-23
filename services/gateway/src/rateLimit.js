const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379');

// Gateway projects entity_type → x-user-role (see attachUserHeaders
// in index.js), so authenticated users arrive here with role
// 'contractor' / 'corporation' rather than the generic 'user'. Both
// share the same per-minute budget as 'user' — they're the same
// kind of caller from a rate-limit POV. Keeping 'user' as an alias
// for anything we add later that legitimately needs that bucket.
// R30 §26 · the anon ceiling was 30/min and a single home-page load
// cost 17 requests, so an anonymous visitor ran out of budget partway
// through their SECOND page. The symptom was not an error page: the
// gateway 429s whatever is still in flight, and the sponsor rail's
// fetch is issued last, so the paid ad slot was the thing that
// silently disappeared.
//
// The duplicates were fixed first (impressions batched into one
// request, enums + legal/settings memoised) which took a load from
// 17 → 10. This raises the ceiling to match real browsing on top of
// that: 60/min is six page loads a minute, enough for home → search
// → listing → back without the rail vanishing, and still nowhere
// near a scripted flood, which arrives in the hundreds.
//
// 🔴 Yulian: this is a numeric default with an abuse-control role.
// 60 is my arithmetic, not your decision — say the word and it
// changes. It stays env-overridable (RATE_LIMIT_ANON) so staging can
// be retuned without a deploy.
const LIMITS = {
  anon:        parseInt(process.env.RATE_LIMIT_ANON  || '60'),
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
  // Bucket by user_id when authenticated — IP alone can starve every
  // real user behind a single NAT / Docker bridge. Anon still buckets
  // by IP because there's no better identifier before login.
  const userId = req.headers['x-user-id'];
  const ip     = req.ip || req.socket.remoteAddress;
  const bucket = userId ? `u:${userId}` : `ip:${ip}`;
  const minute = Math.floor(Date.now() / 60000);
  const key    = `rate:${role}:${bucket}:${minute}`;

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
