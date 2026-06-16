const router   = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { getPool }    = require('../db');
const { sendSms }    = require('../sms');
const { sendMessage } = require('../messaging');
const { vonageWebhookAuth, captureRawBody } = require('../sms/vonageWebhookAuth');

// Meta-approved WhatsApp template name registered with Vonage. Until the
// template is approved by Meta, the WhatsApp send will fail and the
// dispatcher falls back to SMS — so the opt-in is "safe to flip on"
// even before Meta approval lands. Env-overridable so we can rotate
// template names without code changes (e.g. on copy revisions).
const WHATSAPP_OTP_TEMPLATE = process.env.WHATSAPP_OTP_TEMPLATE_NAME || 'tagidai_otp_he';

// ─────────────────────────────────────────────────────────────────────────────
// POST /internal/otp
// Channel-aware OTP send — called by the auth service. The auth service
// already knows the user's whatsapp_opt_in flag (it queries auth_db); it
// passes the preference here and we pick the channel + template + falls
// back to SMS on any WhatsApp failure so the user always gets the code.
// NOT routed through the gateway (internal Docker network only).
// ─────────────────────────────────────────────────────────────────────────────
router.post('/internal/otp', async (req, res) => {
  const { phone, code, whatsapp_opt_in: whatsappOptIn } = req.body;
  if (!phone || !code) {
    return res.status(400).json({ error: 'phone and code required' });
  }

  // Build the rendered text the same for both channels — Vonage uses it
  // as the WhatsApp template's fallback_text, and the SMS provider uses
  // it verbatim. Identical wording means the user sees the same content
  // either way (modulo the channel).
  const message = `קוד האימות שלך לכניסה לפורטל TagidAI הוא: ${code}\nבתוקף 10 דקות. אל תשתף קוד זה.`;

  const channel = whatsappOptIn ? 'auto' : 'sms';
  try {
    const result = await sendMessage(phone, message, {
      channel,
      templateName:   whatsappOptIn ? WHATSAPP_OTP_TEMPLATE : undefined,
      templateParams: whatsappOptIn ? [code] : undefined,
    });
    res.json({ sent: true, channel: result.channel, messageId: result.messageId });
  } catch (err) {
    console.error('[OTP] send failed:', err.message);
    res.status(500).json({ error: 'otp_send_failed', detail: err.message });
  }
});

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

// ─────────────────────────────────────────────────────────────────────────────
// Vonage Messages API — WhatsApp inbound + status webhooks
//
// The Messages API is a SEPARATE Vonage product from the SMS REST API used
// above. Auth is the same Signature Secret JWT as SMS webhooks (verified
// by the shared vonageWebhookAuth middleware).
//
// Payload shape differences from SMS:
//   - inbound:  message_uuid, from, to, channel, message_type, text, timestamp
//   - status:   message_uuid, to, from, channel, status, timestamp, error?
//
// Vonage retries non-2xx responses, so we ALWAYS return 200 once we've
// successfully stored the row (or surfaced a non-retryable error). Storage
// failures are logged but still return 200 so we don't pile up retries on
// transient DB issues.
// ─────────────────────────────────────────────────────────────────────────────

router.post('/webhooks/vonage/messages/inbound', captureRawBody, vonageWebhookAuth, async (req, res) => {
  const body = req.body || {};
  const {
    message_uuid: messageUuid,
    from,
    to,
    channel,
    message_type: messageType = 'text',
    text,
    timestamp,
  } = body;

  if (!messageUuid || !from) {
    console.warn('[vonage-messages-inbound] missing required fields');
    return res.status(400).json({ error: 'missing_required_fields' });
  }

  // Only persist text inbound for now. Media (image/video/audio/document)
  // arrives with a `url` that's a Vonage-hosted, time-limited link —
  // proper handling requires re-uploading to our own storage and lives
  // in the WhatsApp P4 inbox feature, not P1.
  if (messageType !== 'text') {
    console.log(`[vonage-messages-inbound] non-text message_type=${messageType} from=${from} — logged, not persisted`);
    return res.status(200).json({ ok: true, skipped: 'non_text' });
  }

  let receivedAt = null;
  if (timestamp) {
    const d = new Date(timestamp);
    if (!isNaN(d.getTime())) receivedAt = d;
  }

  const pool = getPool();
  try {
    await pool.query(
      `INSERT INTO support_messages
         (id, channel, direction, peer_phone, message_text, message_uuid, received_at)
       VALUES (?, ?, 'inbound', ?, ?, ?, ?)`,
      [uuidv4(), channel || 'whatsapp', from, text || '', messageUuid, receivedAt],
    );
    console.log(`[vonage-messages-inbound] stored from=${from} uuid=${messageUuid}`);
  } catch (err) {
    console.error('[vonage-messages-inbound] DB error:', err.message);
    // 200 anyway — Vonage retries on non-2xx and we don't want a transient
    // DB blip to spam us with duplicate retries that may eventually land.
  }

  res.status(200).json({ ok: true });
});

router.post('/webhooks/vonage/messages/status', captureRawBody, vonageWebhookAuth, async (req, res) => {
  const body = req.body || {};
  const {
    message_uuid: messageUuid,
    status,
    timestamp,
    error,
  } = body;

  if (!messageUuid || !status) {
    return res.status(400).json({ error: 'missing_required_fields' });
  }

  let eventAt = null;
  if (timestamp) {
    const d = new Date(timestamp);
    if (!isNaN(d.getTime())) eventAt = d;
  }

  // Each transition lands in its own column on whatsapp_message_log. We
  // also normalise 'submitted' to fill in the column even on the first
  // status event, in case the send-side INSERT didn't get a chance to
  // (the status webhook can arrive before our send's UPDATE under rare
  // races with very fast Vonage delivery).
  const errMsg = error?.detail || error?.title || error?.message || null;
  const updates = ['status = ?', 'delivery_err = COALESCE(?, delivery_err)'];
  const params  = [status, errMsg];
  if (status === 'submitted' && eventAt) { updates.push('submitted_at = COALESCE(submitted_at, ?)'); params.push(eventAt); }
  if (status === 'delivered' && eventAt) { updates.push('delivered_at = ?');                          params.push(eventAt); }
  if (status === 'read'      && eventAt) { updates.push('read_at = ?');                               params.push(eventAt); }
  params.push(messageUuid);

  const pool = getPool();
  try {
    const [result] = await pool.query(
      `UPDATE whatsapp_message_log SET ${updates.join(', ')} WHERE message_uuid = ?`,
      params,
    );
    if (result.affectedRows === 0) {
      // Status for a message we didn't initiate (e.g. admin sent manually
      // via Vonage dashboard) — log and ignore.
      console.warn(`[vonage-messages-status] no log row for uuid=${messageUuid} status=${status}`);
    }
  } catch (err) {
    console.error('[vonage-messages-status] DB error:', err.message);
  }

  res.status(200).json({ ok: true });
});

module.exports = router;
