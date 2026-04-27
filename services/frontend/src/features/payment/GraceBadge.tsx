'use client';

import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck, Clock, XCircle, AlertTriangle } from 'lucide-react';
import { paymentApi } from '@/lib/api';
import { Button } from '@/components/ui/button';

interface Props {
  dealId: string;
  graceExpiresAt: string;            // ISO string
  onCancelled: () => void;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'הסתיים';
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const mins  = totalMinutes % 60;
  const secs  = Math.floor((ms % 60_000) / 1000);
  if (hours >= 1) return `${hours} שעות ו-${String(mins).padStart(2, '0')} דקות`;
  if (mins >= 1)  return `${mins}:${String(secs).padStart(2, '0')} דקות`;
  return `${secs} שניות`;
}

/**
 * Shown while a deal is in the `authorized` state. Displays:
 *   - Friendly "money reserved" message
 *   - Countdown until auto-capture
 *   - Cancel button (disabled once the window closes)
 */
export function GraceBadge({ dealId, graceExpiresAt, onCancelled }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason]         = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [error, setError]           = useState('');

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const expiresMs = new Date(graceExpiresAt).getTime();
  const remaining = expiresMs - now;
  const expired   = remaining <= 0;

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
          <div className="flex items-center gap-2 text-xs text-emerald-700 mt-1">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            {expired ? (
              <span>חלון הביטול הסתיים — החיוב מתבצע כעת</span>
            ) : (
              <span>
                נותר לביטול ללא חיוב: <strong>{formatCountdown(remaining)}</strong>
              </span>
            )}
          </div>
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
