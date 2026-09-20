const sgMail = require('@sendgrid/mail');
const Handlebars = require('handlebars');
const { getPool } = require('../db');
const { v4: uuidv4 } = require('uuid');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// R10 §0/§4 · non-production email allowlist. Decisions doc §4:
//   "Seeds and tests → @example.com only. Explicit ban on
//    temp@gmail.com as a test target — it's a real person's mailbox."
// Env var EMAIL_ALLOWLIST_DOMAINS is a comma-separated list of
// domain suffixes; only recipients whose domain matches are sent to
// when NODE_ENV !== 'production'. Anything else is logged
// (status='blocked_by_allowlist') and dropped. In production the
// gate is disabled — real users need real deliveries.
//
// Default when the env var is unset in a non-prod env: block
// everything except example.com + tagidai.com. Same effect as
// setting EMAIL_ALLOWLIST_DOMAINS explicitly; safer default so a
// fresh staging deploy doesn't spam real addresses before the env
// var lands.
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const EMAIL_ALLOWLIST_DOMAINS = (
  process.env.EMAIL_ALLOWLIST_DOMAINS || 'example.com,tagidai.com'
)
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

function isEmailAllowed(recipient) {
  if (IS_PRODUCTION) return true;
  if (!recipient || typeof recipient !== 'string') return false;
  const domain = recipient.split('@').pop()?.toLowerCase() || '';
  if (!domain) return false;
  // Suffix match — a whitelist entry 'tagidai.com' matches
  // 'accessibility@tagidai.com' and 'no-reply@mail.tagidai.com'.
  return EMAIL_ALLOWLIST_DOMAINS.some((allowed) =>
    domain === allowed || domain.endsWith('.' + allowed)
  );
}

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

  // R10 §0/§4 · allowlist gate. Log and drop instead of sending —
  // the log row stays queryable so an admin can spot "email that
  // would have gone" when debugging. `blocked_by_allowlist` is a new
  // status value; the notification_log schema uses VARCHAR so no
  // migration is needed to introduce it.
  if (!isEmailAllowed(recipientEmail)) {
    await pool.query(
      "UPDATE notification_log SET status='blocked_by_allowlist', error_message=? WHERE id=?",
      [
        `NODE_ENV=${process.env.NODE_ENV || 'unset'} · allowlist=[${EMAIL_ALLOWLIST_DOMAINS.join(',')}]`,
        logId,
      ]
    );
    console.warn(
      `[mailer] BLOCKED (allowlist) ${eventKey} → ${recipientEmail} ` +
      `— set EMAIL_ALLOWLIST_DOMAINS or run with NODE_ENV=production`
    );
    return;
  }

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
