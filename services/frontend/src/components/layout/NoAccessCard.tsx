'use client';

// P0-2 — the "no access" screen for RoleGuard.
//
// Renders instead of a blank page when a role/section mismatch can't
// be silently reconciled (see RoleGuard.tsx for the decision tree).
//
// Four variants:
//   redirecting     — a light placeholder while the guard's router.replace
//                     resolves. Empty of prose so it doesn't flash text.
//   need-corporation— contractor-only account hit a /corporation/* route
//                     that doesn't mirror to /contractor/*.
//   need-contractor — corporation-only account hit a /contractor/* route
//                     that doesn't mirror to /corporation/*.
//   admin-only      — non-admin hit a /admin/* route.
//
// The CTA copy is DELIBERATELY coordinated with P0-3's "add role"
// action. When P0-3 lands the /register/<role>?add=1 flow (append
// membership to existing user), this CTA links straight into it.
// Keeping the string ("הוסף חשבון תאגיד" / "הוסף חשבון קבלן") stable
// across the two features so a user sees the same label whether they
// arrive here from a mis-hit or from their own switcher menu.

import Link from 'next/link';
import { Building2, HardHat, ShieldAlert, ArrowLeft } from 'lucide-react';

export type NoAccessVariant =
  | 'redirecting'
  | 'need-corporation'
  | 'need-contractor'
  | 'admin-only';

interface Props { variant: NoAccessVariant }

export function NoAccessCard({ variant }: Props) {
  if (variant === 'redirecting') {
    // Kept minimal — the guard is about to swap the whole layout, so
    // any heavy visual would just flash before the next screen paints.
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50" aria-busy="true">
        <div className="text-slate-400 text-sm">מעביר…</div>
      </div>
    );
  }

  const copy = variant === 'need-corporation' ? {
    icon:       Building2,
    heading:    'אין לך חשבון תאגיד',
    lede:       'המסך הזה זמין רק לחשבונות תאגיד. אפשר להוסיף חשבון תאגיד לחשבון הקיים שלך, או לחזור לדשבורד שלך.',
    ctaHref:    '/register/corporation?add=1',
    ctaLabel:   'הוסף חשבון תאגיד',
    backHref:   '/contractor/dashboard',
    backLabel:  'חזרה לדשבורד',
  } : variant === 'need-contractor' ? {
    icon:       HardHat,
    heading:    'אין לך חשבון קבלן',
    lede:       'המסך הזה זמין רק לחשבונות קבלן. אפשר להוסיף חשבון קבלן לחשבון הקיים שלך, או לחזור לדשבורד שלך.',
    ctaHref:    '/register/contractor?add=1',
    ctaLabel:   'הוסף חשבון קבלן',
    backHref:   '/corporation/dashboard',
    backLabel:  'חזרה לדשבורד',
  } : {
    icon:       ShieldAlert,
    heading:    'אין הרשאה',
    lede:       'המסך הזה זמין רק למנהלי מערכת.',
    ctaHref:    '/',
    ctaLabel:   'חזרה לדף הבית',
    backHref:   null,
    backLabel:  null,
  };

  const Icon = copy.icon;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-8" dir="rtl">
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm text-center">
        <div className="mx-auto w-14 h-14 rounded-full bg-slate-100 text-brand-700 flex items-center justify-center mb-4">
          <Icon className="w-7 h-7" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-bold text-slate-900">{copy.heading}</h1>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">{copy.lede}</p>

        <div className="mt-6 flex flex-col sm:flex-row gap-2 sm:justify-center">
          <Link
            href={copy.ctaHref}
            className="inline-flex items-center justify-center gap-2 bg-brand-800 hover:bg-brand-900 text-white text-sm font-semibold px-4 py-2.5 rounded-lg"
          >
            {copy.ctaLabel}
          </Link>
          {copy.backHref && (
            <Link
              href={copy.backHref}
              className="inline-flex items-center justify-center gap-2 border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-semibold px-4 py-2.5 rounded-lg"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              {copy.backLabel}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
