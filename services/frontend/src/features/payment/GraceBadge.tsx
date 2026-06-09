'use client';

import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck, Clock, XCircle, AlertTriangle, Lock, CheckCircle2 } from 'lucide-react';
import { paymentApi } from '@/lib/api';
import { Button } from '@/components/ui/button';

interface Props {
  dealId: string;
  /** Auto-capture moment — end of the cancel-without-charge window.
   *  Drives the in-window countdown + the past-window "delayed" copy. */
  graceExpiresAt: string;
  /** When the corp first submitted workers and the J5 hold was placed
   *  on the card. Distinct from `approvedAt`: the corp's money was
   *  already frozen here, before the contractor said anything. */
  holdPlacedAt?: string | null;
  /** When the contractor approved — the moment the cancel-without-
   *  charge window opened. Equal to `graceExpiresAt` minus 48h. */
  approvedAt?: string | null;
  onCancelled: () => void;
}

// MySQL TIMESTAMP comes back without timezone but the DB stores UTC.
// Normalise so all the displayed times match real elapsed regardless
// of the corp's browser locale.
function parseUtcMs(iso: string): number {
  let s = iso.trim();
  if (s.includes(' ') && !s.includes('T')) s = s.replace(' ', 'T');
  if (!/[Zz]$|[+-]\d{2}:?\d{2}$/.test(s)) s = s + 'Z';
  return new Date(s).getTime();
}

function pad(n: number): string { return n < 10 ? `0${n}` : String(n); }

// HH:MM:SS — corp asked for a real ticking clock with seconds.
function formatHMS(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const totalSec = Math.floor(ms / 1000);
  const ss = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const mm = totalMin % 60;
  const hh = Math.floor(totalMin / 60);
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

function formatDateTime(iso: string): string {
  return new Date(parseUtcMs(iso)).toLocaleString('he-IL', {
    day:    '2-digit',
    month:  '2-digit',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  });
}

// Past the scheduled capture by more than this and still in
// `authorized` means the cron didn't run / failed. Switch to a
// rose-toned "contact admin" state instead of the soft amber
// "soon" copy, which lies once we're days late.
const STUCK_THRESHOLD_MS = 60 * 60 * 1000;  // 1 hour

/**
 * Banner shown while a deal is in `payment_status = authorized`.
 * Surfaces the full payment timeline:
 *   1. When the corp's money was frozen (J5 hold placed)
 *   2. When the contractor approved (cancel-without-charge window opened)
 *   3. When the auto-capture is scheduled — with live HH:MM:SS countdown
 *      while in-window, or a "delayed — contact admin" warning if the
 *      window has been past for over an hour without a capture happening.
 * Cancel button is only enabled while the deal is in-window.
 */
export function GraceBadge({ dealId, graceExpiresAt, holdPlacedAt, approvedAt, onCancelled }: Props) {
  // SSR-safe seed — server render + first client render produce
  // identical HTML, then useEffect ticks to real Date.now().
  const [now, setNow] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason]         = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [error, setError]           = useState('');

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const expiresMs   = parseUtcMs(graceExpiresAt);
  const remaining   = now === 0 ? 48 * 3600_000 : expiresMs - now;
  const expired     = now !== 0 && remaining <= 0;
  // "stuck" = the auto-capture should have run by now but the deal
  // is still authorized. Differentiates the legitimate "just barely
  // past the window" state from the dead-cron / stuck-payment one.
  const stuck       = expired && (-remaining) > STUCK_THRESHOLD_MS;

  async function handleCancel() {
    setCancelling(true); setError('');
    try {
      await paymentApi.cancelEngagement(dealId, reason || undefined);
      onCancelled();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בביטול');
    } finally {
      setCancelling(false);
    }
  }

  if (confirming) {
    return (
      <div className="bg-white border-2 border-amber-300 rounded-2xl px-4 py-3 space-y-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-slate-900">לבטל את ההתחייבות?</p>
            <p className="text-xs text-slate-500 mt-0.5">הסכום שהוקפא על הכרטיס ישוחרר מיד — לא יבוצע חיוב.</p>
          </div>
        </div>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="סיבה (אופציונלי)"
          rows={2}
          className="w-full text-xs rounded-lg border border-slate-300 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setConfirming(false)} disabled={cancelling}>
            חזרה
          </Button>
          <Button size="sm" variant="destructive" onClick={handleCancel} disabled={cancelling}>
            {cancelling ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />מבטל...</> : 'כן, בטל את ההתחייבות'}
          </Button>
        </div>
      </div>
    );
  }

  // ── stuck-payment branch ─────────────────────────────────────────
  // Different visual tone (rose) because this isn't "all good, just
  // waiting" — it's "the system should have charged you days ago and
  // didn't, admin needs to look at this."
  if (stuck) {
    return (
      <div className="bg-rose-50 border border-rose-300 rounded-2xl px-4 py-3.5 space-y-2">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-rose-900">החיוב התעכב — נדרשת התערבות אדמין</p>
            <p className="text-xs text-rose-700 mt-1">
              החיוב היה אמור להתבצע ב-<span className="font-semibold">{formatDateTime(graceExpiresAt)}</span>
              {' '}ועדיין לא בוצע. הסכום עדיין מוקפא על הכרטיס. נא לפנות לאדמין המערכת.
            </p>
          </div>
        </div>
        {(holdPlacedAt || approvedAt) && (
          <div className="ms-8 pt-1 border-t border-rose-100 grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px] text-rose-700">
            {holdPlacedAt && (
              <span className="inline-flex items-center gap-1.5">
                <Lock className="h-3 w-3 shrink-0" />
                סכום הוקפא: <span className="font-semibold">{formatDateTime(holdPlacedAt)}</span>
              </span>
            )}
            {approvedAt && (
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-3 w-3 shrink-0" />
                הקבלן אישר: <span className="font-semibold">{formatDateTime(approvedAt)}</span>
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── normal in-window / just-past-window branch ──────────────────
  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3.5 space-y-3">
      <div className="flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          {/* Title was hardcoded to "עסקה אושרה ע״י הקבלן" regardless
              of whether the contractor had actually approved. The
              badge renders the moment the J5 hold is placed (right
              after the corp commits workers + card auth), so corps
              were seeing "contractor approved" minutes — sometimes
              hours — before the contractor even saw the proposal.
              Gate on `approvedAt` so the headline matches reality. */}
          {approvedAt ? (
            <>
              <p className="text-sm font-bold text-emerald-900">עסקה אושרה ע״י הקבלן — הסכום מוקפא</p>
              <p className="text-[11px] text-emerald-700/80 mt-0.5">
                ניתן עדיין לבטל ללא חיוב עד תום חלון הביטול (48 שעות מאישור הקבלן).
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-bold text-emerald-900">הסכום הוקפא — ממתין לאישור הקבלן</p>
              <p className="text-[11px] text-emerald-700/80 mt-0.5">
                כרטיס האשראי שלך תופס בשלב זה את סכום העמלה בלבד, אך טרם בוצע חיוב בפועל. החיוב יתבצע רק לאחר אישור העסקה על ידי הקבלן ואישור רשימת העובדים מטעמו.
              </p>
            </>
          )}
        </div>
        {!expired && (
          <Button size="sm" variant="outline" onClick={() => setConfirming(true)}
            className="text-xs border-red-200 text-red-600 hover:bg-red-50 shrink-0">
            <XCircle className="h-3.5 w-3.5" />
            בטל התחייבות
          </Button>
        )}
      </div>

      {/* Timeline strip — per user feedback, dropped the "חיוב צפוי"
          column. Corps were confusing the projected-capture timestamp
          with "money is being charged at this exact time" and asking
          why we were already showing a charge date before the deal
          was final. Now we only surface the events that have actually
          occurred (hold placed / contractor approved). The countdown
          below carries the "time remaining" message. */}
      <div className="ms-8 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        {holdPlacedAt && (
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-widest font-bold text-emerald-700/70 inline-flex items-center gap-1">
              <Lock className="h-3 w-3" /> סכום הוקפא
            </p>
            <p className="text-emerald-900 font-semibold">{formatDateTime(holdPlacedAt)}</p>
          </div>
        )}
        {approvedAt && (
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-widest font-bold text-emerald-700/70 inline-flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> הקבלן אישר
            </p>
            <p className="text-emerald-900 font-semibold">{formatDateTime(approvedAt)}</p>
          </div>
        )}
      </div>

      {/* Countdown row — only when there's actually time left. The
          big monospace clock makes the urgency tangible vs the
          earlier "23:59 שעות" prose. */}
      {!expired && (
        <div className="ms-8 flex items-center gap-2 pt-1 border-t border-emerald-100">
          <Clock className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
          <span
            dir="ltr"
            className="font-mono font-extrabold tabular-nums text-base leading-none text-emerald-800"
          >
            {formatHMS(remaining)}
          </span>
          <span className="text-xs text-emerald-700">זמן שנותר לסגירת העסקה</span>
        </div>
      )}
    </div>
  );
}
