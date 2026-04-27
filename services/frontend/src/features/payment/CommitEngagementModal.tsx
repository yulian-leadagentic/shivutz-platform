'use client';

import { useState } from 'react';
import { Loader2, ShieldCheck, CreditCard, X as XIcon, CheckCircle2 } from 'lucide-react';
import { paymentApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import type { CommitEngagementResult } from '@/types';

const STORAGE_KEY = (dealId: string) => `commit_${dealId}_lpid`;

interface Props {
  dealId: string;
  totalAmount?: number;          // known up-front if we have it; otherwise we show "~"
  vatRate?: number;              // e.g. 0.18
  workerCount: number;
  gracePeriodHours?: number;     // from admin setting; default 48
  onAuthorized: (r: CommitEngagementResult) => void;  // fake-mode success path
  onClose: () => void;
}

/**
 * Confirmation modal shown before initiating a J5 pre-authorization.
 *
 * Shows the deal amount, explains the 48h grace window, and — on confirm —
 * calls the commit endpoint.
 *   Real mode: stores `low_profile_id` in sessionStorage and redirects to
 *              Cardcom. On return, the deal page calls `completeAuth`.
 *   Fake mode: backend has already set the transaction to `authorized`;
 *              modal transitions to an inline success state and `onAuthorized`
 *              is fired so the parent can refresh.
 */
export function CommitEngagementModal({
  dealId, totalAmount, vatRate = 0.18, workerCount,
  gracePeriodHours = 48, onAuthorized, onClose,
}: Props) {
  const [phase, setPhase]   = useState<'confirm' | 'working' | 'fake_success'>('confirm');
  const [error, setError]   = useState('');

  // Display-only amounts (backend is the source of truth for commit).
  const base = totalAmount ? totalAmount / (1 + vatRate) : undefined;
  const vat  = totalAmount && base ? totalAmount - base : undefined;

  async function handleConfirm() {
    setPhase('working');
    setError('');
    try {
      const result = await paymentApi.commitEngagement(dealId);
      if (result.fake_mode) {
        setPhase('fake_success');
        // Give the user a beat to see the success state, then notify parent.
        setTimeout(() => onAuthorized(result), 900);
        return;
      }
      if (result.redirect_url) {
        // Real mode — stash the low_profile_id for the return leg, then redirect.
        if (result.low_profile_id) {
          sessionStorage.setItem(STORAGE_KEY(dealId), result.low_profile_id);
        }
        window.location.href = result.redirect_url;
        return;
      }
      throw new Error('שגיאה: השרת לא החזיר כתובת להפניה');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה ביצירת התחייבות');
      setPhase('confirm');
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100">
          <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
            <CreditCard className="h-4 w-4 text-brand-600" />
            אישור התחייבות לעסקה
          </h3>
          <button onClick={onClose} disabled={phase === 'working'}
            className="text-slate-400 hover:text-slate-700 disabled:opacity-40">
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-4">
          {phase === 'fake_success' ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-500" />
              <p className="text-lg font-bold text-slate-900">הסליקה הושלמה</p>
              <p className="text-sm text-slate-500">
                ההתחייבות אושרה במצב סימולציה. המשך לצפייה בעסקה.
              </p>
            </div>
          ) : (
            <>
              {/* Amount */}
              <div className="bg-brand-50 border border-brand-200 rounded-xl px-4 py-3 space-y-1.5">
                <p className="text-xs text-brand-700 font-medium">סכום לחיוב</p>
                {totalAmount ? (
                  <>
                    <p className="text-2xl font-bold text-brand-900">
                      ₪{totalAmount.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className="text-[11px] text-brand-700 flex flex-wrap gap-x-3">
                      <span>בסיס: ₪{base?.toFixed(2)}</span>
                      <span>מע״מ ({Math.round(vatRate * 100)}%): ₪{vat?.toFixed(2)}</span>
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-brand-700">יחושב על ידי השרת בעת האישור</p>
                )}
                <p className="text-[11px] text-brand-700 pt-1">
                  עבור {workerCount} עובדים
                </p>
              </div>

              {/* How it works */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 space-y-1.5 text-xs text-slate-600">
                <div className="flex items-start gap-2">
                  <span className="shrink-0 font-bold text-brand-600 w-4 text-center">1</span>
                  <p>תועבר לטופס מאובטח של <strong>קארדקום</strong> להזנת פרטי כרטיס</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="shrink-0 font-bold text-brand-600 w-4 text-center">2</span>
                  <p>הסכום יוקפא על הכרטיס (<strong>אין חיוב בפועל</strong>) למשך {gracePeriodHours} שעות</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="shrink-0 font-bold text-brand-600 w-4 text-center">3</span>
                  <p>תוכל <strong>לבטל</strong> את ההתחייבות במהלך החלון ללא חיוב</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="shrink-0 font-bold text-brand-600 w-4 text-center">4</span>
                  <p>בתום החלון מבוצע <strong>חיוב אוטומטי</strong> של הסכום שהוקפא, וחשבונית נשלחת לדוא״ל</p>
                </div>
              </div>

              {/* Security line */}
              <div className="flex items-start gap-2 text-[11px] text-slate-500">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  פרטי הכרטיס נשמרים אצל קארדקום בלבד (תקן PCI-DSS).
                  במערכת שלנו נשמר רק מזהה ההרשאה לצורך חיוב/ביטול.
                </span>
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {phase !== 'fake_success' && (
          <div className="flex items-center justify-end gap-2 px-5 pb-4 pt-1 border-t border-slate-100">
            <Button variant="outline" size="sm" onClick={onClose} disabled={phase === 'working'}>
              ביטול
            </Button>
            <Button size="sm" onClick={handleConfirm} disabled={phase === 'working'}>
              {phase === 'working'
                ? <><Loader2 className="h-4 w-4 animate-spin" />מתבצע...</>
                : 'המשך לתשלום'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Look up (and clear) a pending low_profile_id for a deal. */
export function consumePendingLowProfile(dealId: string): string | null {
  const v = typeof window !== 'undefined' ? sessionStorage.getItem(STORAGE_KEY(dealId)) : null;
  if (v && typeof window !== 'undefined') sessionStorage.removeItem(STORAGE_KEY(dealId));
  return v;
}
