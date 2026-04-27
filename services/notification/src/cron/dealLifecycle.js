const DEAL_URL = process.env.DEAL_SERVICE_URL || 'http://deal:3005';

async function callInternal(path, label) {
  const res = await fetch(`${DEAL_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    console.error(`[cron] ${label} failed (${res.status}): ${await res.text()}`);
    return null;
  }
  return res.json();
}

/**
 * Hourly — fan out to the three deal-lifecycle internal endpoints:
 *   1. expire corp_committed deals past their 7-day window
 *   2. capture J5 holds for approved deals past the 48h scheduled_capture_at
 *   3. nudge admin about deals pending contractor approval > 24h
 *
 * Each call is independent — a failure in one does not block the others.
 */
async function runDealLifecycleCron() {
  const expired  = await callInternal('/deals/internal/expire-pending', 'expire_pending');
  const captured = await callInternal('/deals/internal/capture-due',   'capture_due');
  const nudged   = await callInternal('/deals/internal/admin-nudge',   'admin_nudge');
  console.log(
    `[cron] Deal lifecycle: expired=${expired?.expired ?? '?'} ` +
    `captured=${captured?.captured ?? '?'}/${captured?.failed ?? '?'} failed ` +
    `nudged=${nudged?.nudged ?? '?'}`
  );
}

module.exports = { runDealLifecycleCron };
