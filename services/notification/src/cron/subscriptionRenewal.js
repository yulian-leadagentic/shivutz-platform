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

async function runSubscriptionRenewalCron() {
  const secret = process.env.INTERNAL_BATCH_SECRET;
  if (!secret) {
    console.warn('[cron/renewal] INTERNAL_BATCH_SECRET not set — skipping');
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
      console.error('[cron/renewal] batch failed', res.status, body);
      return { ok: false, status: res.status, body };
    }
    console.log('[cron/renewal] batch OK', body);
    return { ok: true, ...body };
  } catch (err) {
    console.error('[cron/renewal] batch threw', err);
    return { ok: false, error: String(err) };
  }
}

module.exports = { runSubscriptionRenewalCron };
