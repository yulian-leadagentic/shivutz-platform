'use client';

// Pivot/v2 — contact-reveal modal.
// One component covers 4 states: not-logged, expired, quota-hit, error.
// The success state is handled inline on the caller (contact info shown
// in the ad card); the modal only appears when reveal is blocked.

import { useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { X, UserPlus, LogIn, CreditCard, Sparkles } from 'lucide-react';
import { writePendingReveal, clearPendingReveal } from '@/features/prospect/state';

export type RevealBlock =
  | { kind: 'unauth';  adId: string }
  | { kind: 'expired'; tier: string; adId: string }
  | { kind: 'quota';   tier: string; used: number; limit: number; adId: string }
  | { kind: 'error';   message: string };

function returnHref(adId: string): string {
  return `/?reveal=${encodeURIComponent(adId)}`;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function RevealModal({
  block,
  onClose,
}: {
  block: RevealBlock | null;
  onClose: () => void;
}) {
  const dialogRef  = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);

  // O1 — stash reveal intent so /login /register /billing round-trips
  // survive OTP restart, tab refresh, or a lost returnTo URL param.
  // 'error' has no adId so nothing to stash. Cleared on explicit close
  // and on successful reveal (caller-side).
  useEffect(() => {
    if (!block || block.kind === 'error') return;
    writePendingReveal({ adId: block.adId, kind: block.kind });
  }, [block]);

  const handleClose = useCallback(() => {
    clearPendingReveal();
    onClose();
  }, [onClose]);

  // R1 — a11y: focus-trap, Esc-to-close, return-focus-on-close.
  // pre-verify-r1 audit added: body-scroll-lock while open.
  useEffect(() => {
    if (!block) return;
    // Remember what was focused when the modal opened (typically the
    // Reveal button on an ad card) so we can put focus back after close.
    returnFocusTo.current = document.activeElement as HTMLElement | null;

    // Focus the first focusable inside the modal (usually the close X).
    // Focusing the title itself keeps screen-readers oriented; use the
    // dialog root as the anchor so tab starts inside.
    const first = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? dialogRef.current)?.focus();

    // Body-scroll lock. Preserve whatever inline overflow was there
    // (usually empty) so we don't clobber an unrelated caller's lock.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl  = items[items.length - 1];
      const active  = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      // Return focus to whatever opened the modal.
      returnFocusTo.current?.focus?.();
    };
  }, [block, handleClose]);

  if (!block) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={handleClose}
    >
      <div
        ref={dialogRef}
        className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 space-y-4 outline-none"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reveal-modal-title"
        aria-describedby="reveal-modal-desc"
        tabIndex={-1}
      >
        <button
          type="button"
          onClick={handleClose}
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
              <h2 id="reveal-modal-title" className="text-lg font-bold text-slate-900">כדי לראות פרטי קשר</h2>
              <p id="reveal-modal-desc" className="text-sm text-slate-600 mt-1 leading-relaxed">
                חפשו אצלנו בחינם. חשיפת פרטי הקשר של תאגידים דורשת חשבון עם מנוי פעיל — 14 ימי ניסיון חינם.
              </p>
            </div>
            <div className="space-y-2">
              <Link
                href={`/register/contractor?returnTo=${encodeURIComponent(returnHref(block.adId))}`}
                className="w-full bg-brand-600 hover:bg-brand-800 text-slate-900 text-sm font-semibold px-4 py-2.5 rounded-lg inline-flex items-center justify-center gap-2"
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
              <h2 id="reveal-modal-title" className="text-lg font-bold text-slate-900">המנוי לא פעיל</h2>
              <p id="reveal-modal-desc" className="text-sm text-slate-600 mt-1 leading-relaxed">
                תקופת הניסיון או המנוי שלך הסתיים. חדש את המנוי כדי להמשיך לחשוף פרטי קשר.
              </p>
            </div>
            <Link
              href="/billing"
              className="w-full bg-brand-600 hover:bg-brand-800 text-slate-900 text-sm font-semibold px-4 py-2.5 rounded-lg inline-flex items-center justify-center gap-2"
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
              <h2 id="reveal-modal-title" className="text-lg font-bold text-slate-900">הגעת למגבלת החודש</h2>
              <p id="reveal-modal-desc" className="text-sm text-slate-600 mt-1 leading-relaxed">
                השתמשת ב-{block.used} מתוך {block.limit} חשיפות במסלול <b>{block.tier}</b>. שדרג את המנוי לחשיפות ללא הגבלה.
              </p>
            </div>
            <Link
              href="/billing"
              className="w-full bg-brand-600 hover:bg-brand-800 text-slate-900 text-sm font-semibold px-4 py-2.5 rounded-lg inline-flex items-center justify-center gap-2"
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
              <h2 id="reveal-modal-title" className="text-lg font-bold text-slate-900">שגיאה</h2>
              <p id="reveal-modal-desc" className="text-sm text-slate-600 mt-1 leading-relaxed">{block.message}</p>
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
