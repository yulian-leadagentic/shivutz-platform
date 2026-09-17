'use client';

// R4 §4 · seat-upgrade dialog. Shown when a contractor tries to invite
// beyond their `included + paid + granted` band and the server returns
// 402 seat_upgrade_required. Reads the price + seats breakdown from
// the 402 body, POSTs to /payments/subscriptions/seats/purchase, and
// closes on success. The endpoint is idempotency-keyed so a double-
// click cannot double-charge — the client generates one uuid per
// modal open.

import { useMemo, useState } from 'react';
import { Loader2, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { subscriptionApi } from '@/lib/api/payments';
import { Button } from '@/components/ui/button';
import { mapApiError } from '@/lib/api/errors';

export interface SeatUpgradeDetail {
  tier:     string;
  used:     number;
  included: number;
  price:    number;               // ₪/month per extra seat
  seats?: {
    included: number;
    paid:     number;
    granted:  number;
    total:    number;
  };
}

interface Props {
  detail:    SeatUpgradeDetail;
  onClose:   () => void;
  /** Called after a successful purchase — the caller should refresh
   *  its seat state / retry the invite. `duplicate` is true when the
   *  server detected an idempotency-key replay and did NOT charge. */
  onSuccess: (info: { count: number; extra_seats_paid: number; duplicate: boolean }) => void;
}

// Simple uuid without pulling a dep. Not crypto-grade — only used as
// an idempotency key; the server rejects reuse via payment_events
// UNIQUE so weak randomness only affects the client-side dedup guess.
function uuidish(): string {
  return `sk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function SeatUpgradeModal({ detail, onClose, onSuccess }: Props) {
  const [count,   setCount]   = useState(1);
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [success, setSuccess] = useState<{ count: number; duplicate: boolean } | null>(null);

  // Fresh key per modal open so the server dedup fires only on a
  // genuine double-submit within THIS modal.
  const idempotencyKey = useMemo(uuidish, []);

  const total = count * detail.price;

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await subscriptionApi.purchaseSeats(count, idempotencyKey);
      setSuccess({ count: res.count, duplicate: res.duplicate });
      onSuccess({
        count:            res.count,
        extra_seats_paid: res.extra_seats_paid,
        duplicate:        res.duplicate,
      });
    } catch (err) {
      setError(mapApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="seat-upgrade-title"
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 end-3 text-slate-400 hover:text-slate-700 rounded-md p-1"
          aria-label="סגור"
          type="button"
        >
          <X className="w-5 h-5" />
        </button>

        {success ? (
          <div className="text-center py-2">
            <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-3" />
            <h2 id="seat-upgrade-title" className="text-lg font-bold text-slate-900">
              {success.duplicate
                ? 'הרכישה כבר בוצעה'
                : `${success.count} מושבים נוספו לחשבון`}
            </h2>
            <p className="text-sm text-slate-500 mt-2">
              {success.duplicate
                ? 'זיהינו לחיצה כפולה. לא בוצע חיוב שני.'
                : 'החיוב מופיע בעמוד החיובים. אפשר לחזור להזמין את המשתמש.'}
            </p>
            <Button onClick={onClose} className="mt-4 w-full">חזרה</Button>
          </div>
        ) : (
          <>
            <h2 id="seat-upgrade-title" className="text-lg font-bold text-slate-900">
              רכישת מושב נוסף
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              המסלול שלך כולל {detail.included} משתמשים.
              {detail.seats && detail.seats.paid + detail.seats.granted > 0 && (
                <> נוספו {detail.seats.paid} שנרכשו ו-{detail.seats.granted} מהנהלה.</>
              )}
            </p>

            <div className="mt-4 space-y-3">
              <label className="block text-sm">
                <span className="text-slate-700 mb-1 block">כמה מושבים לרכוש?</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={count}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    setCount(Number.isFinite(n) ? Math.max(1, Math.min(20, n)) : 1);
                  }}
                  className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </label>

              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm">
                <div className="flex justify-between text-slate-600">
                  <span>מחיר למושב לחודש</span>
                  <span>₪{detail.price}</span>
                </div>
                <div className="flex justify-between text-slate-600 mt-1">
                  <span>מושבים</span>
                  <span>×{count}</span>
                </div>
                <div className="flex justify-between font-bold text-slate-900 pt-2 mt-2 border-t border-slate-200">
                  <span>סה״כ בכל חידוש</span>
                  <span>₪{total}</span>
                </div>
              </div>

              <p className="text-xs text-slate-500 leading-relaxed">
                המושב יהיה זמין להזמנה מיידית. החיוב עצמו מתחיל בחידוש
                הבא של המנוי — לא מתחלק לפי ימים.
              </p>

              {error && (
                <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  onClick={submit}
                  disabled={busy}
                  className="flex-1"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : `אשר רכישה · ₪${total}`}
                </Button>
                <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                  ביטול
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
