const sgMail = require('@sendgrid/mail');
const Handlebars = require('handlebars');
const { getPool } = require('../db');
const { v4: uuidv4 } = require('uuid');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function getTemplate(eventKey) {
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT * FROM notification_templates WHERE event_key = ? AND is_active = TRUE',
    [eventKey]
  );
  return rows[0] || null;
}

async function sendEmail(eventKey, recipientEmail, recipientUserId, variables) {
  const pool = getPool();
  const template = await getTemplate(eventKey);
  if (!template) {
    console.warn(`[mailer] No template for event: ${eventKey}`);
    return;
  }

  const subjectTpl = Handlebars.compile(template.subject_he);
  const bodyTpl    = Handlebars.compile(template.body_he);
  const subject    = subjectTpl(variables);
  const html       = bodyTpl(variables);

  const logId = uuidv4();
  await pool.query(
    'INSERT INTO notification_log (id, event_key, recipient_email, recipient_user_id, subject, status) VALUES (?,?,?,?,?,?)',
    [logId, eventKey, recipientEmail, recipientUserId || null, subject, 'queued']
  );

  try {
    const response = await sgMail.send({
      to:      recipientEmail,
      from:    { email: process.env.SENDGRID_FROM_EMAIL, name: process.env.SENDGRID_FROM_NAME },
      subject,
      html,
    });

    const sgId = response[0]?.headers?.['x-message-id'] || null;
    await pool.query(
      "UPDATE notification_log SET status='sent', sendgrid_id=?, sent_at=NOW() WHERE id=?",
      [sgId, logId]
    );
    console.log(`[mailer] Sent ${eventKey} to ${recipientEmail}`);
  } catch (err) {
    await pool.query(
      "UPDATE notification_log SET status='failed', error_message=? WHERE id=?",
      [err.message, logId]
    );
    console.error(`[mailer] Failed to send ${eventKey}:`, err.message);
  }
}

module.exports = { sendEmail };
