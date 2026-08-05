// Phase-1 fan-out helper.
//
// Used in place of "sendEmail(eventKey, payload.contact_email, ...)" so a
// single event reaches every team member the org flagged as a recipient,
// each on the channels they opted into.
//
// Channel state today:
//   email     — SendGrid, live
//   sms       — Vonage, live
//   whatsapp  — accepted at opt-in time, dispatcher skips for now;
//               Phase 2 will plug in services/notification/src/whatsapp/
//
// Internal call: user-org is reachable on the docker network without the
// gateway's JWT gate, so we hit it directly. The list endpoint returns
// every team member with `is_recipient` + `channels[]` joined in; we
// filter to active recipients here.

const { v4: uuidv4 } = require('uuid');
const { getPool } = require('../db');

const USER_ORG_URL = process.env.USER_ORG_SERVICE_URL || 'http://user-org:3002';

// G5 — write an in-app inbox row for each recipient so the bell menu
// mirrors what was sent. Silent if the write fails (SMS/email is the
// primary; inbox is a convenience surface).
async function writeInboxRow({ recipient_user_id, event_key, title_he, body_he, target_href, channels_sent }) {
  if (!recipient_user_id) return; // anonymous SMS never appears in-app
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO notifications_inbox
         (id, recipient_user_id, event_key, title_he, body_he, target_href, channels_sent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), recipient_user_id, event_key, title_he || event_key, body_he || '', target_href || null, channels_sent || null],
    );
  } catch (e) {
    console.error(`[notifyEntity] inbox insert failed event=${event_key}:`, e.message);
  }
}

async function fetchRecipients(entityType, entityId) {
  const path = entityType === 'corporation'
    ? `/organizations/corporations/${entityId}/notification-recipients`
    : `/organizations/contractors/${entityId}/notification-recipients`;
  try {
    const resp = await fetch(`${USER_ORG_URL}${path}`);
    if (!resp.ok) {
      console.error(`[notifyEntity] recipients fetch ${resp.status} for ${entityType}/${entityId}`);
      return [];
    }
    const rows = await resp.json();
    return rows.filter((r) => r.is_recipient && Array.isArray(r.channels) && r.channels.length > 0);
  } catch (err) {
    console.error(`[notifyEntity] recipients unreachable for ${entityType}/${entityId}:`, err.message);
    return [];
  }
}

/**
 * @param {Object}   args
 * @param {string}   args.entityType  - 'corporation' | 'contractor'
 * @param {string}   args.entityId
 * @param {string}   args.eventKey    - notification_templates.event_key (for email body)
 * @param {Object}   args.emailVars   - Handlebars vars for the email template
 * @param {string}   args.smsText     - rendered SMS body (≤160 chars suggested), incl. the deep link
 * @param {Function} args.sendEmail   - the handlers.js sendEmail closure (signature: eventKey, email, userId, vars)
 * @param {Function} args.sendSms     - SMS sender (sendSmsInternal from handlers.js)
 * @param {Object}  [args.fallback]   - if zero active recipients, fall back to legacy contact { email, phone }
 */
async function notifyEntity({
  entityType, entityId, eventKey,
  emailVars, smsText,
  sendEmail, sendSms,
  fallback = null,
}) {
  const recipients = await fetchRecipients(entityType, entityId);

  // Phase-1 transition guard: orgs that haven't configured any recipients
  // yet should keep getting the single legacy contact email/SMS, otherwise
  // events go silent the moment a corp flips the wrong toggle. Once
  // production orgs have all opted-in their teams this fallback can be
  // removed.
  if (recipients.length === 0 && fallback) {
    if (fallback.email) await sendEmail(eventKey, fallback.email, null, emailVars);
    if (fallback.phone && smsText) await sendSms(fallback.phone, smsText);
    return { count: 0, fellBack: true };
  }

  let sent = 0;
  for (const r of recipients) {
    const channels = r.channels || [];
    const channelsUsed = [];

    if (channels.includes('email') && r.email) {
      try {
        await sendEmail(eventKey, r.email, r.user_id || null, emailVars);
        channelsUsed.push('email');
        sent++;
      } catch (e) { console.error(`[notifyEntity] email ${eventKey} → ${r.email}:`, e.message); }
    }

    if (channels.includes('sms') && r.phone && smsText) {
      try {
        await sendSms(r.phone, smsText);
        channelsUsed.push('sms');
        sent++;
      } catch (e) { console.error(`[notifyEntity] sms ${eventKey} → ${r.phone}:`, e.message); }
    }

    if (channels.includes('whatsapp') && r.phone) {
      // Phase 2 — Vonage WhatsApp sender. For now log and skip so
      // opt-ins are durable through the rollout.
      // eslint-disable-next-line no-console
      console.log(`[notifyEntity] whatsapp skip (provider not live) event=${eventKey} → ${r.phone}`);
    }

    // G5 — inbox mirror. Uses smsText as body_he when available (already
    // rendered for humans). target_href is passed through emailVars.action_url
    // when the template supplies one.
    if (r.user_id && channelsUsed.length > 0) {
      await writeInboxRow({
        recipient_user_id: r.user_id,
        event_key: eventKey,
        title_he: emailVars?.title_he || emailVars?.subject_he || eventKey,
        body_he: smsText || emailVars?.body_he || '',
        target_href: emailVars?.action_url || null,
        channels_sent: channelsUsed.join(','),
      });
    }
  }
  return { count: sent, fellBack: false };
}

module.exports = { notifyEntity };
