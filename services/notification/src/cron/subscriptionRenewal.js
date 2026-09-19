// L5 §6 · daily subscription renewal batch.
//
// Cardcom recurring notifications are the primary path (webhook →
// payment/webhooks.py:cardcom-recurring), but a batch we drive
// ourselves catches:
//   * subs where Cardcom hasn't yet fired an event (real-mode
//     until Cardcom recurring is wired end-to-end)
//   * subs already past_due whose next_attempt_at is due — the
//     failure chain in payment/subscriptions.py:_apply_failure
//     schedules retries in +3d chunks and the batch is what
//     actually fires them.
//
// The endpoint on payment is /payments/subscriptions/internal/renewal-batch
// and is gated by a shared secret (INTERNAL_BATCH_SECRET) that must
// match the header X-Internal-Secret. Both this file and the
// payment service read the value from Railway env.
//
// R11 · the URL was previously '/payments/internal/renewal-batch' —
// missing the `/subscriptions/` segment. subscriptions.router is
// mounted at prefix='/payments/subscriptions' in payment/app/main.py,
// so the correct absolute path includes it. Every prior verification
// ran renewal_batch() via in-process import and never noticed; the
// scheduled 09:00 tick has been 404-ing silently in production.
//
// Idempotency: the batch itself is idempotent via the
// payment_events UNIQUE(provider_transaction_id) — running it twice
// back-to-back charges each due sub at most once. This cron entry
// exists ONLY to fire it on schedule.

const PAYMENT_SVC = process.env.PAYMENT_SERVICE_URL || 'http://payment:3009';

// R11 follow-up · every attempt writes to cron_health via a heartbeat
// POST. That table is what the admin dashboard reads to render "N
// consecutive failures" — the loud-failure surface the URL-typo bug
// was hidden by not having.
async function reportHeartbeat(secret, cronName, ok, errStr, resultObj) {
  try {
    await fetch(`${PAYMENT_SVC}/payments/subscriptions/internal/cron-heartbeat`, {
      method:  'POST',
      headers: { 'X-Internal-Secret': secret, 'content-type': 'application/json' },
      body:    JSON.stringify({ cron_name: cronName, ok, error: errStr || null, result: resultObj || null }),
    });
  } catch (err) {
    // Never let the heartbeat's own failure mask the underlying result.
    console.error('[cron/renewal] heartbeat failed', err);
  }
}

async function runSubscriptionRenewalCron() {
  const secret = process.env.INTERNAL_BATCH_SECRET;
  if (!secret) {
    console.warn('[cron/renewal] INTERNAL_BATCH_SECRET not set — skipping');
    // No heartbeat here — without the secret we can't reach the endpoint
    // anyway. This IS the misconfig case; the admin dashboard rendering
    // 'no heartbeat ever recorded' is itself the signal.
    return { skipped: true };
  }
  try {
    const res = await fetch(`${PAYMENT_SVC}/payments/subscriptions/internal/renewal-batch`, {
      method:  'POST',
      headers: { 'X-Internal-Secret': secret, 'content-type': 'application/json' },
      body:    '{}',
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errStr = `HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`;
      console.error('[cron/renewal] batch failed', res.status, body);
      await reportHeartbeat(secret, 'subscriptionRenewal', false, errStr, null);
      return { ok: false, status: res.status, body };
    }
    console.log('[cron/renewal] batch OK', body);
    await reportHeartbeat(secret, 'subscriptionRenewal', true, null, body);
    return { ok: true, ...body };
  } catch (err) {
    console.error('[cron/renewal] batch threw', err);
    await reportHeartbeat(secret, 'subscriptionRenewal', false, String(err), null);
    return { ok: false, error: String(err) };
  }
}

module.exports = { runSubscriptionRenewalCron };
