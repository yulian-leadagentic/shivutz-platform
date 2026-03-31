const router = require('express').Router();
const { getPool } = require('../db');

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
