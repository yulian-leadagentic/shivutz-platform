// Pivot/v2 — daily "your trial ends in N days" SMS.
//
// Runs once a day. Asks user-org for trialing subs whose trial ends
// within the next 3 days AND haven't been notified yet (latched via
// subscriptions.trial_expiry_notified_at). Sends one SMS per entity
// with a link to /billing so they can upgrade before the trial cuts
// off access.

const USER_ORG_URL = process.env.USER_ORG_SERVICE_URL || 'http://user-org:3002';
const NOTIF_URL    = `http://localhost:${process.env.NOTIF_PORT || 3006}`;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://www.tagidai.com';
const DAYS_AHEAD   = parseInt(process.env.TRIAL_ENDING_DAYS_AHEAD || '3', 10);

async function sendSmsInternal(phone, message) {
  try {
    const resp = await fetch(`${NOTIF_URL}/internal/sms`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ phone, message }),
    });
    if (!resp.ok) console.error('[trial-ending] SMS failed:', await resp.text());
  } catch (err) {
    console.error('[trial-ending] SMS unreachable:', err.message);
  }
}

async function runTrialEndingReminderCron() {
  let resp;
  try {
    resp = await fetch(`${USER_ORG_URL}/ads/internal/trial-ending-batch?days_ahead=${DAYS_AHEAD}`,
      { method: 'POST' });
  } catch (err) {
    console.error('[trial-ending] user-org unreachable:', err.message);
    return;
  }
  if (!resp.ok) {
    console.error(`[trial-ending] user-org ${resp.status}: ${await resp.text()}`);
    return;
  }
  const { targets } = await resp.json();
  if (!Array.isArray(targets) || targets.length === 0) {
    console.log('[trial-ending] nothing to send');
    return;
  }

  const link = `${FRONTEND_URL}/billing`;
  let sent = 0;
  for (const t of targets) {
    const nameSuffix = t.entity_name ? ` (${t.entity_name})` : '';
    const dayLabel   = t.days_left === 1 ? 'מחר' : `בעוד ${t.days_left} ימים`;
    const message =
      `TagidAI — תקופת הניסיון שלכם${nameSuffix} מסתיימת ${dayLabel}. ` +
      `שדרגו למנוי בתשלום כדי להמשיך בפעילות:\n${link}`;
    await sendSmsInternal(t.phone, message);
    sent++;
  }
  console.log(`[trial-ending] sent ${sent}/${targets.length}`);
}

module.exports = { runTrialEndingReminderCron };
