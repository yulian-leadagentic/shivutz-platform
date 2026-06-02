'use client';

// LiveShowcase — inline rotating showcase that sits directly under the
// hero copy on the landing page. Visual contract:
//   ┌───────────────────────────────────────────────────────────────┐
//   │  ● Live  ·  מה קורה עכשיו ב-BuildUp                          │
//   ├───────────────────────────────────────────────────────────────┤
//   │  [big illustration] <one-line activity>                       │
//   │                     <ago line>                                │
//   │                                            [CTA pill →]      │
//   └───────────────────────────────────────────────────────────────┘
//                  הצטרף כדי לראות הכל בזמן אמת
//                  [פתח חשבון בחינם →]
//
// Auto-rotates every ~5s ±0.5s. Pauses on hover and when the tab is
// hidden. Honours prefers-reduced-motion. The card text is the only
// string surfaced — meta is for icon picking — same redaction contract
// as the floating LiveActivityFeed bubble (so when Phase 2 swaps in real
// data, no name/amount can leak).
//
// Why TWO live surfaces (this + LiveActivityFeed bubble)?
//   - LiveActivityFeed = micro-ticker bubble at corner, low cognitive
//     load, runs in the background.
//   - LiveShowcase     = above-the-fold inline section, larger card,
//     stronger CTA — sells the platform breadth.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Users, Home, Briefcase, Handshake,
  Sparkles, Building2, ClipboardList, UserPlus,
} from 'lucide-react';
import { ProfessionIcon } from '@/features/searches/ProfessionIcon';
import { useAuth } from '@/lib/AuthContext';
import { createPicker } from '@/features/live-activity/picker';
import { MIX_SHOWCASE_BY_ROLE, MOCK_ITEMS } from '@/features/live-activity/mocks';
import type { ActivityItem, AudienceRole } from '@/features/live-activity/types';
import { resolveCta } from '@/features/live-activity/ctas';

function audienceFor(entityType: 'contractor' | 'corporation' | null): AudienceRole {
  return entityType ?? 'anon';
}

const CATEGORY_ICON = {
  workers_available:  Users,
  requirement_new:    ClipboardList,
  housing_new:        Home,
  match_closed:       Handshake,
  service_new:        Sparkles,
  corp_active:        Building2,
  contractor_active:  Briefcase,
  platform_pulse:     Sparkles,
} as const;

// Per-category accent — same palette as the floating bubble for visual
// continuity. The bubble + showcase reading the same colour for the
// same category type makes the platform feel coherent.
const CATEGORY_ACCENT: Record<keyof typeof CATEGORY_ICON, {
  iconBg: string; iconText: string; chip: string;
}> = {
  workers_available: { iconBg: 'bg-brand-50',   iconText: 'text-brand-700',   chip: 'bg-brand-100 text-brand-800' },
  requirement_new:   { iconBg: 'bg-amber-50',   iconText: 'text-amber-700',   chip: 'bg-amber-100 text-amber-800' },
  housing_new:       { iconBg: 'bg-emerald-50', iconText: 'text-emerald-700', chip: 'bg-emerald-100 text-emerald-800' },
  match_closed:      { iconBg: 'bg-emerald-50', iconText: 'text-emerald-700', chip: 'bg-emerald-100 text-emerald-800' },
  service_new:       { iconBg: 'bg-sky-50',     iconText: 'text-sky-700',     chip: 'bg-sky-100 text-sky-800' },
  corp_active:       { iconBg: 'bg-navy-50',    iconText: 'text-navy-700',    chip: 'bg-navy-100 text-navy-800' },
  contractor_active: { iconBg: 'bg-brand-50',   iconText: 'text-brand-700',   chip: 'bg-brand-100 text-brand-800' },
  platform_pulse:    { iconBg: 'bg-slate-100',  iconText: 'text-slate-700',   chip: 'bg-slate-100 text-slate-700' },
};

const CATEGORY_LABEL: Record<keyof typeof CATEGORY_ICON, string> = {
  workers_available:  'עובדים זמינים',
  requirement_new:    'דרישה חדשה',
  housing_new:        'מגורים זמינים',
  match_closed:       'התאמה נסגרה',
  service_new:        'שירות חדש',
  corp_active:        'תאגיד פעיל',
  contractor_active:  'קבלן פעיל',
  platform_pulse:     'פעילות בפלטפורמה',
};

// Per-category "why this matters" tagline. Replaces the time-ago line
// (which the bubble already carries) so the showcase reads as a
// substantive value highlight rather than a notification echo. Lines
// are intentionally generic — they should hold even when Phase 2 swaps
// the data source from mocks to real /api/marketplace/activity-feed.
const CATEGORY_TAGLINE: Record<keyof typeof CATEGORY_ICON, string> = {
  workers_available:  'מנוע ההתאמה מציג חבילות מתאימות תוך שניות',
  requirement_new:    'תאגידים מאומתים מגיבים תוך 48 שעות בממוצע',
  housing_new:        'מתוך עשרות מתחמי מגורים פעילים בפלטפורמה',
  match_closed:       'התאמה ממוצעת נסגרת בפלטפורמה תוך 48 שעות',
  service_new:        'ספקים מאומתים — לוגיסטיקה, ויזות, ביטוחים ועוד',
  corp_active:        'תאגידים מורשים מעדכנים זמינות מדי יום',
  contractor_active:  'מאות קבלנים פעילים מחפשים עובדים בפלטפורמה',
  platform_pulse:     'נתון מצטבר מהפעילות בפלטפורמה בתקופה האחרונה',
};

function nextInterval(baseMs: number): number {
  const jitter = (Math.random() - 0.5) * 1000;
  return baseMs + jitter;
}

interface Props {
  /** Default 5000ms; jitter applied so the visible range is ~4–6s. */
  intervalMs?: number;
}

export default function LiveShowcase({ intervalMs = 5000 }: Props) {
  const auth = useAuth();
  const role = audienceFor(auth.entityType);

  const pickerRef = useRef<ReturnType<typeof createPicker> | null>(null);
  const lastRoleRef = useRef<AudienceRole>(role);
  if (!pickerRef.current || lastRoleRef.current !== role) {
    // Showcase-specific weighting — pulls from breadth / opportunity
    // categories so the surface reads as "what the platform offers"
    // rather than echoing the bubble's "what just happened" tone.
    pickerRef.current = createPicker(MOCK_ITEMS, MIX_SHOWCASE_BY_ROLE[role]);
    lastRoleRef.current = role;
  }

  const [current, setCurrent] = useState<ActivityItem | null>(
    () => pickerRef.current!.next(),
  );
  const [paused, setPaused] = useState(false);

  const advance = useCallback(() => {
    const next = pickerRef.current?.next();
    if (next) setCurrent(next);
  }, []);

  useEffect(() => {
    if (paused || !current) return;
    const t = setTimeout(advance, nextInterval(intervalMs));
    return () => clearTimeout(t);
  }, [advance, current, intervalMs, paused]);

  useEffect(() => {
    function onVis() { setPaused(document.visibilityState === 'hidden'); }
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  if (!current) return null;

  const cta = resolveCta(current.cta_intent, role);
  const profCode = current.meta?.profession_code;
  const FallbackIcon = CATEGORY_ICON[current.category];
  const accent = CATEGORY_ACCENT[current.category];
  const categoryLabel = CATEGORY_LABEL[current.category];
  const categoryTagline = CATEGORY_TAGLINE[current.category];

  return (
    <section
      aria-label="פעילות חיה בפלטפורמה"
      className="relative bg-slate-50/60"
    >
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">

        {/* Header — Live label + tagline */}
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full bg-rose-500 animate-live-dot"
            />
            <span className="font-bold text-sm text-slate-800">Live</span>
            <span className="text-slate-300">·</span>
            <span className="text-sm text-slate-600">מה קורה עכשיו ב-BuildUp</span>
          </div>
          <p className="text-xs text-slate-500 leading-snug">
            עובדים, דרישות, מגורים, שירותים והתאמות — הכל בזמן אמת
          </p>
        </div>

        {/* Rotating card — key={current.id} forces remount so the enter
            animation runs every swap. aria-live="polite" so screen
            readers catch updates without nagging. */}
        <div
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          className="rounded-2xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow"
        >
          <div
            key={current.id}
            aria-live="polite"
            className="animate-live-card-enter p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4"
          >
            {/* Big illustration — profession PNG if available, else a
                category-tinted Lucide glyph on a soft circle. Larger
                than the bubble so the showcase feels substantial. */}
            <div className="shrink-0 self-start sm:self-center">
              {profCode ? (
                <div className={`h-16 w-16 sm:h-20 sm:w-20 rounded-2xl ${accent.iconBg} flex items-center justify-center`}>
                  <ProfessionIcon code={profCode} size={68} alt="" />
                </div>
              ) : (
                <div className={`h-16 w-16 sm:h-20 sm:w-20 rounded-2xl ${accent.iconBg} ${accent.iconText} flex items-center justify-center`}>
                  <FallbackIcon className="h-8 w-8 sm:h-10 sm:w-10" strokeWidth={2} />
                </div>
              )}
            </div>

            {/* Body — chip + headline + informative tagline. We
                intentionally DON'T show a "X minutes ago" line here;
                that's the bubble's job. The showcase is a feature
                highlight, not a notification echo. */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                <span className={`inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full ${accent.chip}`}>
                  {categoryLabel}
                </span>
              </div>
              <p className="text-base sm:text-lg font-bold text-slate-900 leading-snug">
                {current.text}
              </p>
              <p className="text-xs sm:text-sm text-slate-500 leading-snug mt-1.5">
                {categoryTagline}
              </p>
            </div>

            {/* CTA — hidden when the intent doesn't fit the audience's
                role; otherwise routes per ctas.ts resolver. */}
            {!cta.hidden && cta.label && (
              <Link
                href={cta.href}
                className="shrink-0 inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-brand-600 text-sm font-bold text-white shadow-sm hover:bg-brand-700 transition-colors self-start sm:self-center"
              >
                {cta.label}
                <ArrowLeft className="h-4 w-4" />
              </Link>
            )}
          </div>
        </div>

        {/* Conversion strip — only for anonymous visitors. Logged-in
            users already converted; serving them the "open a free
            account" CTA again would be noise. */}
        {role === 'anon' && (
          <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-2">
            <p className="text-sm text-slate-600">
              הצטרף כדי לראות הכל בזמן אמת
            </p>
            <Link
              href="/login?intent=contractor"
              className="inline-flex items-center justify-center gap-1.5 px-5 py-2 rounded-full bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold transition-colors"
            >
              <UserPlus className="h-4 w-4" />
              פתח חשבון בחינם
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </div>
        )}

      </div>
    </section>
  );
}
