'use client';

// R38 item 8 · the site sets essential cookies only (the access and
// refresh tokens in lib/auth.ts, the coming-soon bypass), so this is a
// notice, not a consent request.
//
// Rule for later (docs/COOKIES.md): any analytics or advertising tool
// loads only after an explicit opt-in, and this notice then becomes a
// consent request with "מאשר" and "לא מאשר".

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

const STORAGE_KEY = 'cookie_notice_ack';

export default function CookieNotice() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let seen = false;
    try { seen = window.localStorage.getItem(STORAGE_KEY) === '1'; } catch { /* storage blocked: show it */ }
    if (!seen) setOpen(true);
  }, []);

  if (!open) return null;

  function acknowledge() {
    try { window.localStorage.setItem(STORAGE_KEY, '1'); } catch { /* storage blocked: hide for this page view */ }
    setOpen(false);
  }

  return (
    <div
      role="region"
      aria-label="הודעת עוגיות"
      className={
        // Bottom-start (right in RTL). The accessibility FAB holds the
        // bottom-end corner at end-4/end-6, 44px wide, so the inline-end
        // edge stays 12px clear of it on phones; from sm the card has a
        // fixed width and the corner is far away.
        'r32-fade-in fixed z-40 print:hidden ' +
        'bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] sm:bottom-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] ' +
        'start-4 end-[4.5rem] sm:start-6 sm:end-auto sm:w-[26rem] ' +
        'rounded-2xl border border-slate-200 bg-white p-4 shadow-lg ' +
        'flex flex-col gap-3 sm:flex-row sm:items-center'
      }
    >
      <p className="flex-1 text-sm leading-relaxed text-slate-700">
        האתר משתמש בעוגיות חיוניות בלבד, לשמירת ההתחברות שלך. פרטים{' '}
        <Link
          href="/privacy"
          className="font-semibold text-navy-600 underline underline-offset-2 hover:text-navy-500 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-600 focus-visible:ring-offset-2"
        >
          במדיניות הפרטיות
        </Link>
        .
      </p>
      <Button
        type="button"
        size="lg"
        onClick={acknowledge}
        className="w-full shrink-0 sm:w-auto hover:bg-primary-700 focus-visible:ring-navy-600"
      >
        הבנתי
      </Button>
    </div>
  );
}
