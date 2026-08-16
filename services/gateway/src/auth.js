const jwt    = require('jsonwebtoken');
const Redis  = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379');
const SECRET = process.env.JWT_SECRET;
const CACHE_TTL = 300; // 5 minutes

// Startup diagnostic — surfaced once on boot so a JWT_SECRET
// misconfiguration on a fresh Railway env is visible in `docker logs`
// without waiting for the first failed request. Prints presence + a
// short hash, never the secret itself.
if (!SECRET) {
  console.error('[gateway/auth] JWT_SECRET is NOT set — every authenticated request will 401');
} else {
  const fp = require('crypto').createHash('sha256').update(SECRET).digest('hex').slice(0, 8);
  console.log(`[gateway/auth] JWT_SECRET loaded (len=${SECRET.length}, sha256[:8]=${fp})`);
}

// Coarse rate-limiter on log emission: JWT verify failures land on
// every unauthenticated request, and a broken-secret env would flood
// the log with duplicate categorised lines. One line per (category,
// 60s window) is enough to catch a config drift; the rest are still
// silent 401s to the caller.
const LOG_WINDOW_MS = 60_000;
const _lastLogAt = new Map();
function logCategorised(category, extra = '') {
  const now = Date.now();
  const prev = _lastLogAt.get(category) || 0;
  if (now - prev < LOG_WINDOW_MS) return;
  _lastLogAt.set(category, now);
  // Never log the token or SECRET. Category + a short optional
  // detail (e.g. iss/aud claim name that didn't match) is enough.
  console.warn(`[gateway/auth] token_reject reason=${category}${extra ? ' ' + extra : ''}`);
}

// Classify a jsonwebtoken verify failure into the four categories we
// actually act on. Kept as a pure function so it's easy to unit-test
// without a real jwt handy.
function classifyJwtError(err) {
  if (!SECRET)                     return 'no_secret';
  if (!err)                        return 'other';
  if (err.name === 'TokenExpiredError') return 'expired';
  // JsonWebTokenError.message = 'invalid signature' when the secret
  // doesn't match. Other JsonWebTokenError shapes (malformed, invalid
  // token, jwt must be provided) share the same class — split on
  // message so a real secret-mismatch is distinguishable from garbage
  // Bearer strings.
  if (err.name === 'JsonWebTokenError') {
    if (/invalid signature/i.test(err.message)) return 'bad_signature';
    return 'other';
  }
  return 'other';
}

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
  } catch (err) {
    // Previously this swallowed silently, which made a JWT_SECRET
    // mismatch on staging invisible for hours (auth signs with A,
    // gateway verifies with B → every authed call 401s with no
    // signal in the log). Classify + throttle so a broken env is
    // obvious without leaking the token or the secret.
    logCategorised(classifyJwtError(err));
    return null;
  }
}

module.exports = { validateToken, classifyJwtError };
