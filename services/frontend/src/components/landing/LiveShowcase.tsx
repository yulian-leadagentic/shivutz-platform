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
import { useRouter } from 'next/navigation';
import {
  Users, Home, Briefcase, Handshake,
  Sparkles, Building2, ClipboardList,
} from 'lucide-react';
import { ProfessionIcon } from '@/features/searches/ProfessionIcon';
import { useAuth } from '@/lib/AuthContext';
import { createPicker } from '@/features/live-activity/picker';
import { MIX_SHOWCASE_BY_ROLE, MOCK_ITEMS } from '@/features/live-activity/mocks';
import type { ActivityItem, AudienceRole } from '@/features/live-activity/types';
import { RoleChoiceModal } from './RoleChoiceModal';

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
  match_closed:       'עסקה נסגרה',
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
  workers_available:  'המערכת מציעה התאמות מותאמות תוך שניות',
  requirement_new:    'תאגידים מאומתים מגישים הצעות תוך 48 שעות בממוצע',
  housing_new:        'עשרות מתחמי מגורים זמינים לעובדים שלך',
  match_closed:       'עסקאות בפלטפורמה נסגרות בממוצע תוך 48 שעות',
  service_new:        'ספקים מאומתים: לוגיסטיקה, ויזות, ביטוחים ועוד',
  corp_active:        'תאגידים מורשים מעדכנים זמינות מדי יום',
  contractor_active:  'מאות קבלנים פעילים מחפשים עובדים כרגע',
  platform_pulse:     'הנתונים מתעדכנים בזמן אמת',
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
  const router = useRouter();
  const role = audienceFor(auth.entityType);
  // Opens when an anon visitor clicks the card. Logged-in users skip
  // it and route straight to their dashboard.
  const [showRoleModal, setShowRoleModal] = useState(false);

  const pickerRef = useRef<ReturnType<typeof createPicker> | null>(null);
  const lastRoleRef = useRef<AudienceRole>(role);
  if (!pickerRef.current || lastRoleRef.current !== role) {
    // Showcase-specific weighting — pulls from breadth / opportunity
    // categories so the surface reads as "what the platform offers"
    // rather than echoing the bubble's "what just happened" tone.
    pickerRef.current = createPicker(MOCK_ITEMS, MIX_SHOWCASE_BY_ROLE[role]);
    lastRoleRef.current = role;
  }

  // SSR/CSR hydration defense — initialising `current` from
  // pickerRef.current.next() runs the random pick once on the server
  // and a SECOND time on the client, returning different items each
  // call. React then aborts hydration because the rendered HTML
  // diverges (different profession icon / fallback svg), and the
  // recovery pass that regenerates the tree client-side can drop
  // event handlers from other forms on the same page — that's been
  // the silent breakage behind "click does nothing on /login".
  // Defer the first pick to a useEffect so hydration sees `null`
  // on both sides; the `if (!current) return null;` guard below
  // hides the card until the client mounts and the picker resolves.
  const [current, setCurrent] = useState<ActivityItem | null>(null);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (pickerRef.current) setCurrent(pickerRef.current.next());
  }, []);

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

  const profCode = current.meta?.profession_code;
  const FallbackIcon = CATEGORY_ICON[current.category];
  const accent = CATEGORY_ACCENT[current.category];
  const categoryLabel = CATEGORY_LABEL[current.category];
  const categoryTagline = CATEGORY_TAGLINE[current.category];

  /** Card click handler. Logged-in users go straight to their
   *  dashboard; anon visitors get the role-choice popup since we
   *  don't know if they're a contractor or corporation yet. */
  function handleCardClick() {
    if (role === 'contractor')  { router.push('/contractor/dashboard'); return; }
    if (role === 'corporation') { router.push('/corporation/dashboard'); return; }
    setShowRoleModal(true);
  }

  return (
    <section
      aria-label="פעילות חיה בפלטפורמה"
      // Rose-tinted band (was bg-slate-50/60) so the Live surface reads
      // as visually distinct from the white hero above + tile band
      // below. The hue echoes the pulsing rose dot in the header,
      // tying the colour to the "live" semantic.
      className="relative bg-rose-50/40"
    >
      {/* Vertical padding tightened (py-6 sm:py-8 → py-3 sm:py-4) and
          the header→card gap halved so the showcase doesn't blow out
          the hero's single-viewport budget now that it sits between
          the headline and the role tiles.
          Outer container mirrors the role-tiles wrapper exactly
          (max-w-6xl + px-6 → max-w-5xl inner) so the Live card's edges
          line up flush with the קבלן/תאגיד tiles below it. Previously
          this section was max-w-5xl with its own px, which left the
          card visibly narrower than the tiles. */}
      <div className="max-w-6xl mx-auto px-6 w-full py-3 sm:py-4">
       <div className="max-w-5xl mx-auto">

        {/* Header — Live label + tagline. "Live" promoted to a rose
            pill badge so it reads as a status indicator (not just text)
            and ties the colour to the surrounding emphasis treatment. */}
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-500 text-white text-xs font-bold tracking-wide shadow-sm">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-white animate-live-dot"
              />
              LIVE
            </span>
            <span className="text-sm font-semibold text-slate-800">מה קורה עכשיו ב-BuildUp</span>
          </div>
          <p className="text-xs text-slate-500 leading-snug">
            דרישות קבלנים, תאגידים פעילים, עובדים והתאמות — הכל בזמן אמת
          </p>
        </div>

        {/* Rotating card — the whole card is now a button. Clicking it
            either routes a logged-in user to their dashboard or opens
            the role-choice popup for anon visitors. The previous
            per-item inline CTA (resolveCta) was removed because the
            popup is the single, role-agnostic entry point now. */}
        <button
          type="button"
          onClick={handleCardClick}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          aria-label="כניסה לפלטפורמה"
          className="block w-full text-start rounded-2xl border-2 border-rose-200 bg-white shadow-md shadow-rose-100/60 hover:shadow-lg hover:shadow-rose-200/60 hover:border-rose-300 transition-all cursor-pointer"
        >
          <div
            key={current.id}
            aria-live="polite"
            className="animate-live-card-enter p-2.5 sm:p-3.5"
          >
            <div className="flex flex-row items-center gap-3 sm:gap-4">
              <div className="shrink-0">
                {profCode ? (
                  <div className={`h-12 w-12 sm:h-20 sm:w-20 rounded-xl sm:rounded-2xl ${accent.iconBg} flex items-center justify-center`}>
                    <ProfessionIcon code={profCode} size={44} alt="" className="sm:hidden" />
                    <ProfessionIcon code={profCode} size={68} alt="" className="hidden sm:block" />
                  </div>
                ) : (
                  <div className={`h-12 w-12 sm:h-20 sm:w-20 rounded-xl sm:rounded-2xl ${accent.iconBg} ${accent.iconText} flex items-center justify-center`}>
                    <FallbackIcon className="h-6 w-6 sm:h-10 sm:w-10" strokeWidth={2} />
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <span className={`inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full ${accent.chip}`}>
                    {categoryLabel}
                  </span>
                </div>
                <p className="text-sm sm:text-lg font-bold text-slate-900 leading-snug">
                  {current.text}
                </p>
                <p className="text-xs sm:text-sm text-slate-500 leading-snug mt-1.5">
                  {categoryTagline}
                </p>
              </div>
            </div>
          </div>
        </button>

        {/* The "פתח חשבון בחינם" conversion strip was removed — the
            role-tiles in the hero just above already handle the
            "create an account" signal, and the per-card CTA inside
            the showcase already routes anonymous visitors through
            /login. A second sign-up nudge here was duplicating that
            ask without adding value at this stage. */}

       </div>
      </div>

      {/* Role-choice popup for anon visitors. Logged-in users never
          see it (handleCardClick skips it for them). */}
      <RoleChoiceModal open={showRoleModal} onClose={() => setShowRoleModal(false)} />
    </section>
  );
}
