const router   = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { getPool }    = require('../db');
const { sendSms }    = require('../sms');

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

module.exports = router;
