// R12 §5 · persistent accessibility icon → /accessibility on every
// page. Mounted once at the root layout so it appears on landing,
// dashboards, admin, register, marketplace — everywhere. The
// declaration must be reachable from every page per the Israeli
// accessibility regulations (התאמות נגישות לשירות, התשע"ג-2013).
//
// §5b says NO commercial widget: this is a plain link to the
// declaration, not an overlay bar with font-size / contrast toggles.
// Those toggles override the visitor's own OS / browser preferences
// and fight assistive tech — the fix is the site itself being
// accessible, which the declaration then documents.
//
// Placement: bottom-LEFT in the RTL layout (`end-*` since dir=rtl).
// LiveActivityFeed already sits at bottom-start (bottom-right in
// RTL), so this side is clear. Above the iOS safe-area inset so
// the button doesn't get clipped by the home-bar. Min 44×44 tap
// target, visible focus ring, aria-label for SR — nothing about
// its role is decorative.

'use client';

import Link from 'next/link';
import { Accessibility } from 'lucide-react';

export default function AccessibilityFab() {
  return (
    <Link
      href="/accessibility"
      aria-label="הצהרת נגישות"
      title="הצהרת נגישות"
      className={
        // Tap target: h-11 w-11 = 44×44 CSS px, which is the WCAG
        // 2.5.5 minimum. z-40 sits under any modal (z-50) but above
        // ordinary page content. The `pb-[env(safe-area-inset-bottom)]`
        // trick doesn't apply to a fixed button — instead the bottom
        // offset itself picks up the safe-area inset via
        // `bottom-[calc(...)]`. `end-4` = 16px from the LEFT in RTL
        // (opposite side to LiveActivityFeed's `start-4`).
        'fixed z-40 ' +
        'bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] sm:bottom-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] ' +
        'end-4 sm:end-6 ' +
        'h-11 w-11 rounded-full ' +
        'bg-white border border-slate-300 shadow-md ' +
        'inline-flex items-center justify-center ' +
        'text-slate-700 hover:text-brand-700 hover:border-brand-400 ' +
        'transition-colors ' +
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/40 focus-visible:border-brand-500'
      }
    >
      <Accessibility className="w-6 h-6" aria-hidden="true" />
      <span className="sr-only">הצהרת נגישות</span>
    </Link>
  );
}
