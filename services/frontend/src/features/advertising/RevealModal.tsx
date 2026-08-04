'use client';

// Pivot/v2 — contact-reveal modal.
// One component covers 4 states: not-logged, expired, quota-hit, error.
// The success state is handled inline on the caller (contact info shown
// in the ad card); the modal only appears when reveal is blocked.

import Link from 'next/link';
import { X, UserPlus, LogIn, CreditCard, Sparkles } from 'lucide-react';

export type RevealBlock =
  | { kind: 'unauth';  adId: string }
  | { kind: 'expired'; tier: string; adId: string }
  | { kind: 'quota';   tier: string; used: number; limit: number; adId: string }
  | { kind: 'error';   message: string };

function returnHref(adId: string): string {
  return `/?reveal=${encodeURIComponent(adId)}`;
}

export function RevealModal({
  block,
  onClose,
}: {
  block: RevealBlock | null;
  onClose: () => void;
}) {
  if (!block) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 end-3 text-slate-400 hover:text-slate-700"
          aria-label="סגור"
        >
          <X className="w-5 h-5" />
        </button>

        {block.kind === 'unauth' && (
          <>
            <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">כדי לראות פרטי קשר</h2>
              <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                חפשו אצלנו בחינם. חשיפת פרטי הקשר של תאגידים דורשת חשבון עם מנוי פעיל — 14 ימי ניסיון חינם.
              </p>
            </div>
            <div className="space-y-2">
              <Link
                href={`/register/contractor?returnTo=${encodeURIComponent(returnHref(block.adId))}`}
                className="w-full bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg inline-flex items-center justify-center gap-2"
              >
                <UserPlus className="w-4 h-4" />
                הרשם כקבלן — 14 יום חינם
              </Link>
              <Link
                href={`/login?returnTo=${encodeURIComponent(returnHref(block.adId))}`}
                className="w-full bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 text-sm font-semibold px-4 py-2.5 rounded-lg inline-flex items-center justify-center gap-2"
              >
                <LogIn className="w-4 h-4" />
                יש לי חשבון
              </Link>
            </div>
          </>
        )}

        {block.kind === 'expired' && (
          <>
            <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">המנוי לא פעיל</h2>
              <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                תקופת הניסיון או המנוי שלך הסתיים. חדש את המנוי כדי להמשיך לחשוף פרטי קשר.
              </p>
            </div>
            <Link
              href="/billing"
              className="w-full bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg inline-flex items-center justify-center gap-2"
            >
              חדש מנוי
            </Link>
          </>
        )}

        {block.kind === 'quota' && (
          <>
            <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">הגעת למגבלת החודש</h2>
              <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                השתמשת ב-{block.used} מתוך {block.limit} חשיפות במסלול <b>{block.tier}</b>. שדרג את המנוי לחשיפות ללא הגבלה.
              </p>
            </div>
            <Link
              href="/billing"
              className="w-full bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg inline-flex items-center justify-center gap-2"
            >
              שדרג מנוי
            </Link>
          </>
        )}

        {block.kind === 'error' && (
          <>
            <div className="w-10 h-10 rounded-lg bg-red-50 text-red-700 flex items-center justify-center">
              <X className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">שגיאה</h2>
              <p className="text-sm text-slate-600 mt-1 leading-relaxed">{block.message}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg"
            >
              סגור
            </button>
          </>
        )}
      </div>
    </div>
  );
}
