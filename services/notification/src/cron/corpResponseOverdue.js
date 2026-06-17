// Cron: fire admin notifications for `proposed` deals where the
// corp hasn't responded within `corp_response_hours` (default 48h).
//
// One notification per deal (deduped via deal_db.deals
// .proposed_admin_notified_at). Each cron run pulls the un-fired
// overdue rows from the deal service, sends a single summary SMS
// per admin (one row per admin contact), and marks each deal as
// notified so subsequent runs don't double-send.
//
// Notification surface (user-approved option D):
//   * SMS  → every admin user with a phone on file
//   * In-app banner → rendered separately on /admin/dashboard via
//     the /deals/internal/corp-response-overdue/count endpoint
//     (no cron involvement; the banner just polls the count).

const DEAL_URL     = process.env.DEAL_SERVICE_URL || 'http://deal:3005';
const NOTIF_URL    = `http://localhost:${process.env.NOTIF_PORT || 3006}`;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://www.tagidai.com';

async function sendSmsInternal(phone, message) {
  try {
    const resp = await fetch(`${NOTIF_URL}/internal/sms`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ phone, message }),
    });
    if (!resp.ok) console.error('[corp-overdue] SMS failed:', await resp.text());
  } catch (err) {
    console.error('[corp-overdue] SMS unreachable:', err.message);
  }
}

async function runCorpResponseOverdueCron() {
  let resp;
  try {
    resp = await fetch(`${DEAL_URL}/deals/internal/corp-response-overdue`);
  } catch (err) {
    console.error('[corp-overdue] deal service unreachable:', err.message);
    return;
  }
  if (!resp.ok) {
    console.error(`[corp-overdue] deal service ${resp.status}: ${await resp.text()}`);
    return;
  }
  const { hours, deals, admins } = await resp.json();
  if (!Array.isArray(deals) || deals.length === 0) {
    console.log('[corp-overdue] no overdue deals');
    return;
  }
  if (!Array.isArray(admins) || admins.length === 0) {
    console.warn(`[corp-overdue] ${deals.length} overdue but no admins with phone — skipping SMS, still marking notified`);
  } else {
    const link = `${FRONTEND_URL}/admin/dashboard`;
    const noun = deals.length === 1 ? 'בקשה אחת' : `${deals.length} בקשות`;
    const message =
      `TagidAI — ${noun} עברו את חלון התגובה (${hours} שעות) ללא מענה תאגיד.\n` +
      `פתח את לוח הבקרה לבדיקה:\n${link}`;
    for (const a of admins) {
      if (!a.phone) continue;
      await sendSmsInternal(a.phone, message);
    }
  }

  // Latch each deal as notified so the next sweep doesn't re-send.
  let marked = 0;
  for (const d of deals) {
    try {
      const r = await fetch(
        `${DEAL_URL}/deals/internal/corp-response-overdue/${d.id}/mark-notified`,
        { method: 'POST' },
      );
      if (r.ok) marked++;
    } catch (err) {
      console.error(`[corp-overdue] mark-notified failed for ${d.id}:`, err.message);
    }
  }
  console.log(`[corp-overdue] notified admins for ${deals.length} deals, marked ${marked}`);
}

module.exports = { runCorpResponseOverdueCron };
