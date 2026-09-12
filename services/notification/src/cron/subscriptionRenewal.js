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
// The endpoint on payment is /payments/internal/renewal-batch and
// is gated by a shared secret (INTERNAL_BATCH_SECRET) that must
// match the header X-Internal-Secret. Both this file and the
// payment service read the value from Railway env.
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
    const res = await fetch(`${PAYMENT_SVC}/payments/internal/renewal-batch`, {
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
