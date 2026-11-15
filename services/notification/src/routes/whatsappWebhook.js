// Meta Cloud API webhook: the verification handshake, inbound messages
// and delivery statuses.
//
// Public route (the gateway lists /api/webhooks/whatsapp in
// PUBLIC_PREFIXES). What guards it is X-Hub-Signature-256, an HMAC of
// the request body keyed with the app secret, so index.js mounts this
// router behind express.raw and ahead of express.json: the signature
// covers the bytes Meta sent, not a re-serialised copy of them.
const crypto = require('crypto');
const router = require('express').Router();
const { getPool }       = require('../db');
const { handleInbound } = require('../whatsapp/handleInbound');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function hasValidSignature(rawBody, header) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !Buffer.isBuffer(rawBody) || !header) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  return safeEqual(String(header).toLowerCase(), expected);
}

router.get('/', (req, res) => {
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  const verified = !!token
    && req.query['hub.mode'] === 'subscribe'
    && safeEqual(req.query['hub.verify_token'] ?? '', token);
  if (!verified) return res.sendStatus(403);
  // Meta compares the body to the challenge it sent: plain text, no JSON.
  res.status(200).type('text/plain').send(String(req.query['hub.challenge'] ?? ''));
});

router.post('/', (req, res) => {
  if (!hasValidSignature(req.body, req.get('x-hub-signature-256'))) {
    return res.sendStatus(401);
  }
  let payload;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.sendStatus(400);
  }
  // Answer before doing the work. A search can take seconds, and Meta
  // redelivers anything it did not get a 200 for in time.
  res.sendStatus(200);
  processPayload(payload).catch((err) => {
    console.error('[whatsapp-webhook] processing failed:', err.message);
  });
});

async function processPayload(payload) {
  for (const entry of payload?.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const numberId = value.metadata?.phone_number_id;
      // One app can carry several numbers. A message to another number
      // must not be answered from this one.
      if (numberId && numberId !== process.env.WHATSAPP_PHONE_NUMBER_ID) {
        console.warn(`[whatsapp-webhook] event for phone_number_id ${numberId} ignored, it is not WHATSAPP_PHONE_NUMBER_ID`);
        continue;
      }

      for (const status of value.statuses || []) {
        await applyStatus(status).catch((err) => {
          console.error(`[whatsapp-webhook] status ${status.id} not applied:`, err.message);
        });
      }
      // In order and one at a time: the rate limit counts the messages
      // that arrived before the one in hand.
      for (const message of value.messages || []) {
        await handleInbound(message).catch((err) => {
          console.error(`[whatsapp-webhook] inbound ${message.id} failed:`, err.message);
        });
      }
    }
  }
}

// Statuses can arrive out of order ("read" ahead of "delivered"), so
// each one fills in its own timestamp and never moves the row backwards.
async function applyStatus(status) {
  if (!status?.id) return;
  const at = Number(status.timestamp) ? new Date(Number(status.timestamp) * 1000) : new Date();

  let set;
  let params;
  if (status.status === 'sent') {
    set    = "submitted_at = COALESCE(submitted_at, ?), status = IF(status = 'queued', 'submitted', status)";
    params = [at];
  } else if (status.status === 'delivered') {
    set    = "delivered_at = COALESCE(delivered_at, ?), status = IF(status = 'read', status, 'delivered')";
    params = [at];
  } else if (status.status === 'read') {
    set    = "read_at = COALESCE(read_at, ?), status = 'read'";
    params = [at];
  } else if (status.status === 'failed') {
    const error  = status.errors?.[0];
    const detail = error?.error_data?.details || error?.title || error?.message || 'failed';
    set    = "status = 'failed', delivery_err = ?";
    params = [`${error?.code ? `${error.code}: ` : ''}${detail}`.slice(0, 255)];
  } else {
    return;
  }

  const [result] = await getPool().query(
    `UPDATE whatsapp_message_log SET ${set} WHERE message_uuid = ?`,
    [...params, status.id],
  );
  if (result.affectedRows === 0) {
    console.warn(`[whatsapp-webhook] status ${status.status} for ${status.id}: no log row`);
  } else {
    console.log(`[whatsapp-webhook] ${status.id} is ${status.status}`);
  }
}

module.exports = router;
