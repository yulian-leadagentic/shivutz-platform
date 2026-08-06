'use client';

// R1 shared modal a11y primitive.
//
// The Wave-1 R1 pass hardened RevealModal with focus-trap + Esc-close
// + return-focus + body-scroll-lock. LeadCaptureModal, AdInquiryModal,
// and AdPreviewModal each hand-rolled the same modal shape with only
// role="dialog" (or less) and no focus management, so keyboard/screen-
// reader users hit a modal that steals nothing and traps nothing.
//
// This hook centralises the four behaviors so every modal in the app
// can adopt them with one call:
//
//     const dialogRef = useRef<HTMLDivElement>(null);
//     useModalA11y({ open, onClose, dialogRef });
//     ...
//     <div ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1}>...
//
// Deliberately NOT a component — the modal's markup is where each
// caller's design lives (gradient header, form fields, etc.). Wrapping
// it would force a big refactor. A hook is the lightest possible
// shared primitive.
//
// Guarantees while `open` is true:
//   1. Focus moves inside the dialog on the render after open flips true
//      (first focusable, or the dialogRef itself as a fallback).
//   2. Tab / Shift+Tab wraps within the dialog (focus-trap).
//   3. Escape calls onClose.
//   4. document.body.style.overflow = 'hidden' (scroll lock); previous
//      value restored on close.
//   5. Focus returns to whatever was focused when the modal opened.

import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), ' +
  'select:not([disabled]), textarea:not([disabled]), ' +
  '[tabindex]:not([tabindex="-1"])';

interface Options {
  open: boolean;
  onClose: () => void;
  dialogRef: RefObject<HTMLElement | null>;
  /** Optional — if provided AND the ref resolves to a focusable, gets
   *  focus first. Otherwise the first focusable inside dialogRef wins,
   *  falling back to the dialog root. */
  initialFocusRef?: RefObject<HTMLElement | null>;
}

export function useModalA11y({ open, onClose, dialogRef, initialFocusRef }: Options): void {
  useEffect(() => {
    if (!open) return;

    // (5) remember what was focused when we opened; restore on close.
    const previouslyFocused = typeof document !== 'undefined'
      ? (document.activeElement as HTMLElement | null)
      : null;

    // (1) focus into the dialog. Prefer the caller's chosen initial
    //     element, then the first focusable descendant, then the
    //     dialog root itself (tabIndex={-1} makes it focusable).
    const preferred = initialFocusRef?.current;
    const firstInside = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? null;
    (preferred ?? firstInside ?? dialogRef.current)?.focus();

    // (4) body scroll lock. Preserve any pre-existing inline overflow
    //     so we don't clobber an unrelated caller's lock.
    const prevOverflow = typeof document !== 'undefined'
      ? document.body.style.overflow
      : '';
    if (typeof document !== 'undefined') {
      document.body.style.overflow = 'hidden';
    }

    // (2) + (3) key handler: Esc closes; Tab traps.
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
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
      if (typeof document !== 'undefined') {
        document.body.style.overflow = prevOverflow;
      }
      previouslyFocused?.focus?.();
    };
    // dialogRef / initialFocusRef are stable refs; onClose is caller-
    // provided and expected to be stable-ish. Effect re-runs when
    // `open` flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
