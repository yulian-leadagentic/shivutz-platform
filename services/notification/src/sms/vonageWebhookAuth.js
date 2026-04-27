/**
 * Vonage Signed Webhook Middleware
 *
 * Vonage sends a JWT in the Authorization header (Bearer <token>), signed with
 * the account's Signature Secret (different from the API secret).
 *
 * Verification steps:
 *  1. Extract Bearer token from Authorization header
 *  2. Verify HMAC-SHA256 signature using VONAGE_SIGNATURE_SECRET
 *  3. Check `iat` claim is within a 5-minute window (replay protection)
 *  4. Verify `payload_hash` in JWT matches SHA-256 of the raw request body
 *
 * Required env var:
 *   VONAGE_SIGNATURE_SECRET  — from Vonage dashboard → API Settings → Signature Secret
 *
 * Docs: https://developer.vonage.com/en/getting-started/concepts/signing-messages
 */
const crypto = require('crypto');

/**
 * Decode and verify a Vonage HS256 JWT without external dependencies.
 * Returns the decoded payload on success, throws on failure.
 */
function verifyVonageJwt(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed_jwt');

  const [headerB64, payloadB64, signatureB64] = parts;

  // Verify HMAC-SHA256 signature
  const data         = `${headerB64}.${payloadB64}`;
  const expectedSig  = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64url');

  if (!crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(signatureB64))) {
    throw new Error('invalid_signature');
  }

  // Decode payload
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

  // Check issued-at freshness — reject if older than 5 minutes
  const nowSec = Math.floor(Date.now() / 1000);
  if (!payload.iat || Math.abs(nowSec - payload.iat) > 300) {
    throw new Error('jwt_expired_or_future');
  }

  return payload;
}

/**
 * Express middleware — must be applied AFTER express.raw() or express.json()
 * with the raw body captured (see usage in routes).
 *
 * Attaches `req.vonagePayload` (decoded JWT claims) on success.
 */
function vonageWebhookAuth(req, res, next) {
  const secret = process.env.VONAGE_SIGNATURE_SECRET;

  // If no secret is configured, skip verification in development
  if (!secret) {
    console.warn('[vonage-webhook] VONAGE_SIGNATURE_SECRET not set — skipping signature check');
    return next();
  }

  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing_vonage_jwt' });
  }

  const token = authHeader.slice(7).trim();

  let payload;
  try {
    payload = verifyVonageJwt(token, secret);
  } catch (err) {
    console.warn('[vonage-webhook] JWT verification failed:', err.message);
    return res.status(401).json({ error: 'invalid_vonage_signature', detail: err.message });
  }

  // Verify payload_hash — SHA-256 of the raw request body (hex)
  if (payload.payload_hash) {
    const rawBody = req.rawBody;                // captured below in captureRawBody middleware
    if (!rawBody) {
      console.warn('[vonage-webhook] rawBody not available — skipping payload_hash check');
    } else {
      const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
      if (bodyHash !== payload.payload_hash) {
        console.warn('[vonage-webhook] payload_hash mismatch — possible tampering');
        return res.status(401).json({ error: 'payload_hash_mismatch' });
      }
    }
  }

  req.vonagePayload = payload;
  next();
}

/**
 * Middleware that captures the raw request body as a Buffer
 * and stores it on req.rawBody, then re-parses as JSON.
 *
 * Mount this BEFORE vonageWebhookAuth on webhook routes.
 *
 * If the parent app uses `express.json({ verify: (req,_,buf) => { req.rawBody = buf } })`
 * (as in notification/src/index.js), req.rawBody is already set and this middleware
 * short-circuits immediately without touching the consumed stream.
 */
function captureRawBody(req, res, next) {
  // Already set by express.json() verify callback — nothing to do.
  if (req.rawBody !== undefined) return next();

  let data = Buffer.alloc(0);
  req.on('data', (chunk) => { data = Buffer.concat([data, chunk]); });
  req.on('end', () => {
    req.rawBody = data;
    try {
      req.body = data.length ? JSON.parse(data.toString('utf8')) : {};
    } catch {
      req.body = {};
    }
    next();
  });
}

module.exports = { vonageWebhookAuth, captureRawBody };
