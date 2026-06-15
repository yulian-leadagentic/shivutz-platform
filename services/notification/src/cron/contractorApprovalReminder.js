// Daily SMS reminder for contractors with stuck corp_committed deals.
//
// User feedback (Wave 5): "תשלח לו הודעת SMS פעם ביום עם קישור לאישור
// או דחיה של העסקאות". This cron runs once a day, asks the deal
// service for one row per contractor whose deals have been waiting
// for approval >24h, and sends each contractor a single Hebrew SMS
// with a deep link into /contractor/deals?filter=proposed.
//
// One SMS per contractor per day — the deal service groups by
// contractor_id, so a contractor with five pending deals gets one
// summary text, not five.

const DEAL_URL     = process.env.DEAL_SERVICE_URL || 'http://deal:3005';
const NOTIF_URL    = `http://localhost:${process.env.NOTIF_PORT || 3006}`;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://app.shivutz.co.il';

async function sendSmsInternal(phone, message) {
  try {
    const resp = await fetch(`${NOTIF_URL}/internal/sms`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ phone, message }),
    });
    if (!resp.ok) console.error('[contractor-reminder] SMS failed:', await resp.text());
  } catch (err) {
    console.error('[contractor-reminder] SMS unreachable:', err.message);
  }
}

async function runContractorApprovalReminderCron() {
  let resp;
  try {
    resp = await fetch(`${DEAL_URL}/deals/internal/contractor-approval-reminder-targets`);
  } catch (err) {
    console.error('[contractor-reminder] deal service unreachable:', err.message);
    return;
  }
  if (!resp.ok) {
    console.error(`[contractor-reminder] deal service ${resp.status}: ${await resp.text()}`);
    return;
  }
  const { targets } = await resp.json();
  if (!Array.isArray(targets) || targets.length === 0) {
    console.log('[contractor-reminder] no contractors with stuck deals');
    return;
  }

  const link = `${FRONTEND_URL}/contractor/deals?filter=proposed`;
  let sent = 0;
  for (const t of targets) {
    if (!t.contact_phone) continue;
    const firstName = (t.contact_name || '').split(' ')[0] || '';
    const greeting = firstName ? `${firstName}, ` : '';
    const requests = Number(t.request_count || 0);
    const requestsLabel = requests > 1
      ? `${requests} בקשות שונות`
      : 'בקשה אחת';
    const pending = Number(t.pending_count || 0);
    const dealsLabel = pending > 1
      ? `${pending} הצעות תאגיד`
      : 'הצעת תאגיד אחת';
    const message =
      `TagidAI — ${greeting}יש לך ${dealsLabel} (${requestsLabel}) הממתינות לאישור שלך מעל 24 שעות.\n` +
      `יש להיכנס ולאשר או לדחות כדי לסגור את העסקה:\n${link}`;
    await sendSmsInternal(t.contact_phone, message);
    sent++;
  }
  console.log(`[contractor-reminder] notified ${sent}/${targets.length} contractors`);
}

module.exports = { runContractorApprovalReminderCron };
