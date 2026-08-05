// Pivot/v2 (spec B3) — corp trial-end grace SMS series.
//
// After trial_ends_at, corps get 4 SMS nudges (day 0, 3, 6, 7). The
// user-org batch endpoint computes which step each sub is due for and
// latches grace_sms_step so this cron is safe to run daily / retry.
//
// Copy is deliberately blunt at day 6 and 7 — those are the moments
// closest to hard-cap and drive the highest conversion (per pivot v2
// decisions). Day 7 fires AFTER the ads have been paused by the
// hard-cap cron, so the wording says "פאוזה" not "יופסקו".

const USER_ORG_URL = process.env.USER_ORG_SERVICE_URL || 'http://user-org:3002';
const NOTIF_URL    = `http://localhost:${process.env.NOTIF_PORT || 3006}`;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://www.tagidai.com';

async function sendSmsInternal(phone, message) {
  try {
    const resp = await fetch(`${NOTIF_URL}/internal/sms`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ phone, message }),
    });
    if (!resp.ok) console.error('[grace] SMS failed:', await resp.text());
  } catch (err) {
    console.error('[grace] SMS unreachable:', err.message);
  }
}

function bodyForStep(step, entityName) {
  // Entity-name suffix — most corps register with a company name; leave
  // it out if we don't have one to avoid an awkward trailing space.
  const suffix = entityName ? ` (${entityName})` : '';
  const link   = `${FRONTEND_URL}/billing`;
  switch (step) {
    case 1:
      return `TagidAI — תקופת הניסיון${suffix} הסתיימה. יש לך 7 ימים לחדש לפני שהמודעות יושהו. חידוש:\n${link}`;
    case 2:
      return `TagidAI — נותרו 4 ימים לחידוש המנוי${suffix} לפני שהמודעות יושהו:\n${link}`;
    case 3:
      return `TagidAI — מחר המודעות${suffix} יושהו ויוסתרו מתוצאות החיפוש. חדש עכשיו:\n${link}`;
    case 4:
      return `TagidAI — המודעות${suffix} הושהו. חדש מנוי כדי להחזירן מיד:\n${link}`;
    default:
      return `TagidAI — עדכון לגבי המנוי${suffix}:\n${link}`;
  }
}

async function runGraceReminderCron() {
  let resp;
  try {
    resp = await fetch(`${USER_ORG_URL}/ads/internal/grace-batch`, { method: 'POST' });
  } catch (err) {
    console.error('[grace] user-org unreachable:', err.message);
    return;
  }
  if (!resp.ok) {
    console.error(`[grace] user-org ${resp.status}: ${await resp.text()}`);
    return;
  }
  const { targets } = await resp.json();
  if (!Array.isArray(targets) || targets.length === 0) {
    console.log('[grace] nothing to send');
    return;
  }
  let sent = 0;
  for (const t of targets) {
    await sendSmsInternal(t.phone, bodyForStep(t.step, t.entity_name));
    sent++;
  }
  console.log(`[grace] sent ${sent}/${targets.length}`);
}

module.exports = { runGraceReminderCron };
