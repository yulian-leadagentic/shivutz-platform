'use client';

// R4 §3a · admin seat-grant dialog. Sets an ABSOLUTE value on
// `extra_seats_granted` — this is the admin freebie band and is
// NEVER billed. A note is mandatory so future admins can see why
// the count was bumped, and every change is audit-logged.

import { useState } from 'react';
import { Loader2, X, CheckCircle2, AlertCircle, ShieldCheck } from 'lucide-react';
import { adminApi } from '@/lib/adminApi';
import { Button } from '@/components/ui/button';
import { mapApiError } from '@/lib/api/errors';

export interface SeatGrantDetail {
  subscriptionId:   string;
  entityName:       string;
  tier:             string;
  seatsIncluded:    number | null;
  seatsPaid:        number;
  seatsGranted:     number;
  seatsUsed:        number;
  seatsNote:        string | null;
}

interface Props {
  detail:    SeatGrantDetail;
  onClose:   () => void;
  /** Called after a successful grant. Caller re-fetches the row
   *  details so the breakdown reflects the new granted count. */
  onSuccess: (info: { granted: number; previous: number; note: string }) => void;
}

export function SeatGrantModal({ detail, onClose, onSuccess }: Props) {
  const [count, setCount] = useState<number>(detail.seatsGranted);
  const [note,  setNote]  = useState<string>(detail.seatsNote || '');
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok,    setOk]    = useState<{ previous: number; granted: number } | null>(null);

  const dirty = count !== detail.seatsGranted || note.trim() !== (detail.seatsNote || '').trim();
  const noteMissing = !note.trim();

  async function submit() {
    if (busy) return;
    if (noteMissing) {
      setError('חייבים הסבר. הענקות מושבים נכנסות לאודיט וחייבות תיעוד.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.grantSeats(detail.subscriptionId, count, note.trim());
      setOk({ previous: res.previous, granted: res.extra_seats_granted });
      onSuccess({ granted: res.extra_seats_granted, previous: res.previous, note: res.seats_note });
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
      aria-labelledby="seat-grant-title"
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

        {ok ? (
          <div className="text-center py-2">
            <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-3" />
            <h2 id="seat-grant-title" className="text-lg font-bold text-slate-900">
              עודכן: {ok.previous} ← {ok.granted} מושבים מהנהלה
            </h2>
            <p className="text-sm text-slate-500 mt-2">
              המנוי כולל כעת {detail.seatsIncluded ?? '?'} + {detail.seatsPaid} + {ok.granted}.
              ההערה נשמרה בשדה seats_note וגם באודיט.
            </p>
            <Button onClick={onClose} className="mt-4 w-full">חזרה</Button>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-2">
              <ShieldCheck className="w-5 h-5 text-brand-600 mt-0.5 shrink-0" />
              <div>
                <h2 id="seat-grant-title" className="text-lg font-bold text-slate-900">
                  הענקת מושבים מהנהלה
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {detail.entityName} · מסלול {detail.tier}
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 space-y-0.5">
              <div className="flex justify-between"><span>כלולים במסלול</span><span>{detail.seatsIncluded ?? '—'}</span></div>
              <div className="flex justify-between"><span>שרכשו</span><span>{detail.seatsPaid}</span></div>
              <div className="flex justify-between"><span>מהנהלה (עכשיו)</span><span>{detail.seatsGranted}</span></div>
              <div className="flex justify-between pt-1 mt-1 border-t border-slate-200 font-semibold text-slate-800">
                <span>בשימוש</span>
                <span>{detail.seatsUsed}</span>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <label className="block text-sm">
                <span className="text-slate-700 mb-1 block">כמה מושבים בסך הכל להעניק? (0-100, ערך מוחלט)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={count}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    setCount(Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0);
                  }}
                  className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </label>

              <label className="block text-sm">
                <span className="text-slate-700 mb-1 block">
                  הערה <span className="text-rose-600">*</span>
                </span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  placeholder="לדוגמה: הרחבה זמנית ללקוח פיילוט Q4"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </label>

              <p className="text-xs text-slate-500 leading-relaxed">
                מושבים אלה <strong>אינם נחשבים לחישוב חיוב</strong> בחידוש הבא —
                רק extra_seats_paid מחויב. ההערה נכנסת לאודיט לצד השינוי.
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
                  disabled={busy || !dirty || noteMissing}
                  className="flex-1"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : `שמור · ${count} מושבים`}
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
