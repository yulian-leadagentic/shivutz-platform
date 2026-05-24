'use client';

import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck, Clock, XCircle, AlertTriangle } from 'lucide-react';
import { paymentApi } from '@/lib/api';
import { Button } from '@/components/ui/button';

interface Props {
  dealId: string;
  graceExpiresAt: string;            // ISO string — auto-capture moment
  freezeStartedAt?: string | null;   // ISO string — when the J5 hold was placed
  onCancelled: () => void;
}

// MySQL TIMESTAMP columns serialize as "YYYY-MM-DD HH:MM:SS" without
// timezone info, but the DB value is UTC. new Date(...) reads such
// strings as LOCAL time, which shifts every timestamp by the user's
// offset. Normalise so the countdown and freeze-time match reality
// regardless of which shape the backend hands us.
function parseUtcMs(iso: string): number {
  let s = iso.trim();
  if (s.includes(' ') && !s.includes('T')) s = s.replace(' ', 'T');
  if (!/[Zz]$|[+-]\d{2}:?\d{2}$/.test(s)) s = s + 'Z';
  return new Date(s).getTime();
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// HH:MM:SS — the corp asked for a real ticking clock with seconds
// rather than the previous "X שעות ו-Y דקות" rounding which only
// moved every minute and felt frozen.
function formatHMS(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const totalSec = Math.floor(ms / 1000);
  const ss = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const mm = totalMin % 60;
  const hh = Math.floor(totalMin / 60);
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

function formatFreezeTime(iso: string): string {
  const d = new Date(parseUtcMs(iso));
  return d.toLocaleString('he-IL', {
    day:   '2-digit',
    month: '2-digit',
    year:  'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  });
}

/**
 * Shown while a deal is in the `authorized` state. Displays:
 *   - Friendly "money reserved" message
 *   - When the freeze was placed (`freezeStartedAt`)
 *   - HH:MM:SS countdown until auto-capture
 *   - Cancel button (disabled once the window closes)
 */
export function GraceBadge({ dealId, graceExpiresAt, freezeStartedAt, onCancelled }: Props) {
  // SSR-safe: seed with 0 so the server render and the first client
  // render produce identical HTML. useEffect (client-only) flips it
  // to real Date.now() post-mount and ticks every second.
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

  const expiresMs = parseUtcMs(graceExpiresAt);
  // While not yet mounted (now=0), pin the countdown to a 48h
  // placeholder so SSR + first-client render produce identical
  // HTML and we don't briefly paint a millions-of-hours value
  // computed against the epoch. Real ticks start once useEffect
  // populates `now`.
  const remaining = now === 0 ? 48 * 3600_000 : expiresMs - now;
  const expired   = now !== 0 && remaining <= 0;

  async function handleCancel() {
    setCancelling(true);
    setError('');
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

  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3">
      <div className="flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-emerald-900">הסכום הוקפא על הכרטיס — עסקה אושרה</p>
          {freezeStartedAt && (
            <p className="text-[11px] text-emerald-700/80 mt-0.5">
              הוקפא ב-<span className="font-semibold">{formatFreezeTime(freezeStartedAt)}</span>
            </p>
          )}
          {expired ? (
            <div className="flex items-center gap-2 text-xs text-emerald-700 mt-1.5">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              {/* Honest copy: the window closed, but we can't claim
                  "charging now" — capture runs on a cron, may have
                  already happened (deal will switch to CapturedBadge
                  once payment_status flips), may be queued. Don't
                  promise a state we can't verify in this render. */}
              <span>חלון הביטול נסגר — החיוב יבוצע בקרוב</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 mt-1.5">
              <Clock className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
              <span className="text-xs text-emerald-700">נותר לביטול ללא חיוב:</span>
              <span
                dir="ltr"
                className="font-mono font-extrabold tabular-nums text-base leading-none text-emerald-800"
              >
                {formatHMS(remaining)}
              </span>
            </div>
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
    </div>
  );
}
