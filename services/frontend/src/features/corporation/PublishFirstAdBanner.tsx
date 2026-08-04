'use client';

// Pivot/v2 — corp onboarding nudge on the dashboard.
// Renders only when the corp has zero active ads AND hasn't dismissed
// it. Dismissal is per-browser (localStorage) so a corp can click X and
// it stays gone even if they don't publish immediately.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Megaphone, X } from 'lucide-react';
import { adApi } from '@/lib/api/ads';

const DISMISS_KEY = 'pivot.dismiss_publish_first_banner';

export function PublishFirstAdBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(DISMISS_KEY) === '1') return;
    // Only surface if the corp actually has zero ads. Fetch is cheap and
    // gated on the entity's own ads, so no privacy leak.
    adApi.list()
      .then((rows) => setVisible(rows.length === 0))
      .catch(() => setVisible(false));
  }, []);

  if (!visible) return null;

  function dismiss() {
    window.localStorage.setItem(DISMISS_KEY, '1');
    setVisible(false);
  }

  return (
    <div className="relative rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4 shadow-sm">
      <button
        type="button"
        onClick={dismiss}
        className="absolute top-3 end-3 text-slate-400 hover:text-slate-700"
        aria-label="סגור"
      >
        <X className="w-4 h-4" />
      </button>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
          <Megaphone className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-bold text-slate-900">פרסמו את המודעה הראשונה שלכם</h3>
          <p className="text-sm text-slate-600 mt-1 leading-relaxed">
            מודעת עובדים או דיור לפועלים — קבלנים יראו אתכם בחיפוש ויפנו ישירות.
          </p>
          <Link
            href="/corporation/ads/new"
            className="mt-3 inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2 rounded-lg"
          >
            <Megaphone className="w-4 h-4" />
            פרסם מודעה
          </Link>
        </div>
      </div>
    </div>
  );
}
