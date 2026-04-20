const router   = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { getPool }    = require('../db');
const { sendSms }    = require('../sms');
const { vonageWebhookAuth, captureRawBody } = require('../sms/vonageWebhookAuth');

// ─────────────────────────────────────────────────────────────────────────────
// POST /internal/sms
// Direct synchronous SMS send — called by auth service for time-critical OTPs.
// NOT routed through the gateway (internal Docker network only).
// ─────────────────────────────────────────────────────────────────────────────
router.post('/internal/sms', async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) {
    return res.status(400).json({ error: 'phone and message required' });
  }

  const pool = getPool();
  try {
    const result = await sendSms(phone, message);
    await pool.query(
      `INSERT INTO sms_log (id, phone, message, provider, message_id, status)
       VALUES (?, ?, ?, ?, ?, 'sent')`,
      [uuidv4(), phone, message, result.provider, result.messageId]
    );
    res.json({ sent: true, messageId: result.messageId, provider: result.provider });
  } catch (err) {
    console.error('[SMS] Send failed:', err.message);
    await pool.query(
      `INSERT INTO sms_log (id, phone, message, provider, status, error)
       VALUES (?, ?, ?, ?, 'failed', ?)`,
      [uuidv4(), phone, message, process.env.SMS_PROVIDER || 'stub', err.message]
    ).catch(() => {});
    res.status(500).json({ error: 'sms_send_failed', detail: err.message });
  }
});

// GET /admin/sms-log
router.get('/admin/sms-log', async (_, res) => {
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT id, phone, LEFT(message,80) AS message_preview, provider, message_id, status, error, created_at FROM sms_log ORDER BY created_at DESC LIMIT 200'
  );
  res.json(rows);
});

// GET /notifications/user/:userId
router.get('/notifications/user/:userId', async (req, res) => {
  const pool = getPool();
  const [rows] = await pool.query(
    "SELECT * FROM notification_log WHERE recipient_user_id = ? ORDER BY created_at DESC LIMIT 50",
    [req.params.userId]
  );
  res.json(rows);
});

// GET /admin/notification-log
router.get('/admin/notification-log', async (_, res) => {
  const pool = getPool();
  const [rows] = await pool.query(
    "SELECT * FROM notification_log ORDER BY created_at DESC LIMIT 200"
  );
  res.json(rows);
});

// GET /admin/notification-templates
router.get('/admin/notification-templates', async (_, res) => {
  const pool = getPool();
  const [rows] = await pool.query("SELECT * FROM notification_templates ORDER BY event_key");
  res.json(rows);
});

// PATCH /admin/notification-templates/:id
router.patch('/admin/notification-templates/:id', async (req, res) => {
  const { subject_he, subject_en, body_he, body_en } = req.body;
  const pool = getPool();
  await pool.query(
    "UPDATE notification_templates SET subject_he=?, subject_en=?, body_he=?, body_en=?, updated_at=NOW() WHERE id=?",
    [subject_he, subject_en, body_he, body_en, req.params.id]
  );
  res.json({ updated: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Vonage Signed Webhooks
//
// Both endpoints are PUBLIC (no user JWT) — Vonage calls them directly.
// They are secured instead by the Vonage Signature Secret JWT
// (vonageWebhookAuth middleware).
//
// Gateway must list /api/webhooks/vonage in PUBLIC_PREFIXES.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /webhooks/vonage/dlr
 * Vonage Delivery Receipt — updates sms_log with delivery status.
 *
 * Vonage payload fields used:
 *   messageId   — matches sms_log.message_id
 *   status      — delivered | expired | failed | rejected | accepted | buffered
 *   err-code    — Vonage numeric error code (string)
 *   scts        — delivery timestamp (YYYYMMDDHHMMSS or ISO-ish)
 */
router.post('/webhooks/vonage/dlr', captureRawBody, vonageWebhookAuth, async (req, res) => {
  const body = req.body || {};
  const { messageId, status, 'err-code': errCode, scts } = body;

  if (!messageId) {
    console.warn('[vonage-dlr] Missing messageId in DLR payload');
    return res.status(400).json({ error: 'missing_messageId' });
  }

  // Parse Vonage scts timestamp (format: "YYYY-MM-DD HH:MM:SS" or "YYYYMMDDHHmmSS")
  let deliveredAt = null;
  if (scts) {
    // Vonage sends "2020-01-01 12:00:00" or compact "2001011200000"
    const ts = scts.replace(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1-$2-$3 $4:$5:$6');
    const d = new Date(ts);
    if (!isNaN(d.getTime())) deliveredAt = d;
  }

  const pool = getPool();
  try {
    const [result] = await pool.query(
      `UPDATE sms_log
          SET delivery_status = ?,
              delivery_err    = ?,
              delivered_at    = ?
        WHERE message_id = ?`,
      [status || null, errCode || null, deliveredAt, messageId]
    );

    if (result.affectedRows === 0) {
      // Vonage can retry DLRs — log but don't error
      console.warn(`[vonage-dlr] No sms_log row found for messageId=${messageId}`);
    } else {
      console.log(`[vonage-dlr] Updated messageId=${messageId} → status=${status}`);
    }
  } catch (err) {
    console.error('[vonage-dlr] DB error:', err.message);
    // Return 200 so Vonage doesn't keep retrying on transient DB errors
  }

  // Vonage expects 200 OK with no body (or minimal body)
  res.status(200).end();
});

/**
 * POST /webhooks/vonage/inbound
 * Vonage Inbound SMS — logs messages sent TO the platform's virtual number.
 *
 * Vonage payload fields used:
 *   msisdn          — sender phone number
 *   to              — virtual number that received the message
 *   messageId       — unique message ID
 *   text            — message content
 *   type            — text | unicode | binary
 *   message-timestamp — ISO timestamp
 */
router.post('/webhooks/vonage/inbound', captureRawBody, vonageWebhookAuth, async (req, res) => {
  const body = req.body || {};
  const {
    msisdn,
    to,
    messageId,
    text,
    type = 'text',
    'message-timestamp': messageTimestamp,
  } = body;

  if (!msisdn || !messageId) {
    console.warn('[vonage-inbound] Missing required fields in inbound payload');
    return res.status(400).json({ error: 'missing_required_fields' });
  }

  let receivedAt = null;
  if (messageTimestamp) {
    const d = new Date(messageTimestamp);
    if (!isNaN(d.getTime())) receivedAt = d;
  }

  const pool = getPool();
  try {
    await pool.query(
      `INSERT INTO inbound_sms_log
         (id, from_phone, to_number, message_id, message_text, message_type, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), msisdn, to || '', messageId, text || '', type, receivedAt]
    );
    console.log(`[vonage-inbound] Logged inbound SMS from=${msisdn} messageId=${messageId}`);
  } catch (err) {
    console.error('[vonage-inbound] DB error:', err.message);
  }

  res.status(200).end();
});

// GET /admin/inbound-sms-log
router.get('/admin/inbound-sms-log', async (_, res) => {
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT id, from_phone, to_number, message_id, LEFT(message_text,120) AS message_preview, message_type, received_at, created_at FROM inbound_sms_log ORDER BY created_at DESC LIMIT 200'
  );
  res.json(rows);
});

module.exports = router;
