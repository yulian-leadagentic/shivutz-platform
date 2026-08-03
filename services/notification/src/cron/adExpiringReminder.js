// Pivot/v2 — daily "your ad expires in N days" SMS.
//
// Runs once a day. Asks user-org for active ads whose expires_at is
// within the next 3 days AND haven't been notified (latched via
// ads.expiry_notified_at). SMS to the corp's contact_phone with a
// deep link to /corporation/ads so they can edit / republish before
// the ad disappears from search results.

const USER_ORG_URL = process.env.USER_ORG_SERVICE_URL || 'http://user-org:3002';
const NOTIF_URL    = `http://localhost:${process.env.NOTIF_PORT || 3006}`;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://www.tagidai.com';
const DAYS_AHEAD   = parseInt(process.env.AD_EXPIRY_DAYS_AHEAD || '3', 10);

async function sendSmsInternal(phone, message) {
  try {
    const resp = await fetch(`${NOTIF_URL}/internal/sms`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ phone, message }),
    });
    if (!resp.ok) console.error('[ad-expiring] SMS failed:', await resp.text());
  } catch (err) {
    console.error('[ad-expiring] SMS unreachable:', err.message);
  }
}

async function runAdExpiringReminderCron() {
  let resp;
  try {
    resp = await fetch(`${USER_ORG_URL}/ads/internal/ad-expiring-batch?days_ahead=${DAYS_AHEAD}`,
      { method: 'POST' });
  } catch (err) {
    console.error('[ad-expiring] user-org unreachable:', err.message);
    return;
  }
  if (!resp.ok) {
    console.error(`[ad-expiring] user-org ${resp.status}: ${await resp.text()}`);
    return;
  }
  const { targets } = await resp.json();
  if (!Array.isArray(targets) || targets.length === 0) {
    console.log('[ad-expiring] nothing to send');
    return;
  }

  const link = `${FRONTEND_URL}/corporation/ads`;
  let sent = 0;
  for (const t of targets) {
    const title    = (t.title || '').slice(0, 60);
    const dayLabel = t.days_left === 1 ? 'מחר' : `בעוד ${t.days_left} ימים`;
    const message =
      `TagidAI — המודעה "${title}" תפוג ${dayLabel} ותוסתר מתוצאות החיפוש. ` +
      `לעריכה או פרסום מחדש:\n${link}`;
    await sendSmsInternal(t.phone, message);
    sent++;
  }
  console.log(`[ad-expiring] sent ${sent}/${targets.length}`);
}

module.exports = { runAdExpiringReminderCron };
