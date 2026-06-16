/**
 * Vonage WhatsApp sender — uses the Vonage Messages API (NOT the SMS REST
 * API used in ../sms/vonage.js). Messages API is a separate Vonage product
 * with its own auth model (JWT signed by the Application's private key)
 * and its own endpoint.
 *
 * Required env vars (notification service):
 *   VONAGE_APPLICATION_ID   — UUID from the Vonage Application page
 *   VONAGE_PRIVATE_KEY      — full PEM, including -----BEGIN PRIVATE KEY-----
 *                             headers. Railway: paste as a multi-line value.
 *   VONAGE_WHATSAPP_NUMBER  — E.164 without +, e.g. 972524669987
 *
 * Two send modes:
 *   - Template send (templateName + variables) — required when initiating
 *     a conversation outside the 24h customer-service window. The template
 *     must be pre-approved by Meta via the Vonage dashboard.
 *   - Free-text send (no templateName) — only valid within 24h of the
 *     user's last inbound message. Vonage rejects with 1001 / outside-window
 *     when used otherwise.
 *
 * See https://developer.vonage.com/en/messages/code-snippets/whatsapp/send-text
 */
const https = require('https');
const jwt   = require('jsonwebtoken');

const VONAGE_MESSAGES_HOST = 'api.nexmo.com';
const VONAGE_MESSAGES_PATH = '/v1/messages';

// Cache the signed JWT so we don't re-sign on every send. Vonage Application
// JWTs are valid for 15 minutes by default; refresh a couple of minutes
// before expiry to avoid clock-skew edge cases.
let cachedJwt = null;
let cachedJwtExpiresAt = 0;

function buildJwt() {
  const appId   = process.env.VONAGE_APPLICATION_ID;
  const privKey = process.env.VONAGE_PRIVATE_KEY;
  if (!appId || !privKey) {
    throw new Error('VONAGE_APPLICATION_ID and VONAGE_PRIVATE_KEY must be set');
  }
  // RS256 — Vonage Application keypair is RSA. The PEM in env vars often
  // has literal \n sequences (Railway pastes them that way); normalise.
  const pem = privKey.replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);
  const expSeconds = 15 * 60;
  const token = jwt.sign(
    { application_id: appId, iat: now, jti: `${now}-${Math.random().toString(36).slice(2)}` },
    pem,
    { algorithm: 'RS256', expiresIn: expSeconds },
  );
  cachedJwt = token;
  cachedJwtExpiresAt = (now + expSeconds - 60) * 1000; // refresh 1 min early
  return token;
}

function getJwt() {
  if (!cachedJwt || Date.now() >= cachedJwtExpiresAt) return buildJwt();
  return cachedJwt;
}

/**
 * Send a WhatsApp message via Vonage Messages API.
 *
 * @param {string}  phone         — E.164 recipient (with or without leading +)
 * @param {string}  message       — body text. For template sends this is the
 *                                  RENDERED text (Vonage requires it for
 *                                  display purposes even with a template).
 * @param {object}  [opts]
 * @param {string}  [opts.templateName] — Meta-approved template name to use.
 *                                       Required for out-of-window sends.
 * @param {string[]} [opts.templateParams] — positional params substituted
 *                                          into the template's {{1}} {{2}}…
 *                                          placeholders.
 * @returns {Promise<{ messageId: string }>}
 */
async function send(phone, message, opts = {}) {
  const from = process.env.VONAGE_WHATSAPP_NUMBER;
  if (!from) throw new Error('VONAGE_WHATSAPP_NUMBER must be set');

  const to = phone.startsWith('+') ? phone.slice(1) : phone;
  const token = getJwt();

  // Payload shape — text vs template differ in Vonage's spec.
  // https://developer.vonage.com/en/api/messages-olympus
  const payload = opts.templateName
    ? {
        message_type: 'template',
        channel:      'whatsapp',
        from,
        to,
        template: {
          name:     opts.templateName,
          language: { code: 'he', policy: 'deterministic' },
          parameters: (opts.templateParams || []).map((v) => ({ type: 'text', text: String(v) })),
          // Including the rendered body helps Vonage's own logging show
          // human-readable content — purely a debug aid, not required.
          fallback_text: message,
        },
      }
    : {
        message_type: 'text',
        channel:      'whatsapp',
        from,
        to,
        text: message,
      };
  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: VONAGE_MESSAGES_HOST,
      path:     VONAGE_MESSAGES_PATH,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Authorization':  `Bearer ${token}`,
        'Accept':         'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        // Vonage returns 202 Accepted with { message_uuid } on success;
        // 4xx with { type, title, detail, instance } on validation errors.
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = null; }
        if (res.statusCode === 202 && parsed?.message_uuid) {
          return resolve({ messageId: parsed.message_uuid });
        }
        const detail = parsed?.detail || parsed?.title || data || `HTTP ${res.statusCode}`;
        reject(new Error(`Vonage WhatsApp send failed (${res.statusCode}): ${detail}`));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { send };
