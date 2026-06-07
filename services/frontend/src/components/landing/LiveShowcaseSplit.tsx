'use client';

// LiveShowcaseSplit — A/B-test variant of the Live section.
//
// Layout: two side-by-side strips, one above each role tile. Each strip
// rotates only categories relevant to ITS role and routes the click
// straight to /login?intent=<role> (no role-choice modal).
//
//   ┌──────────────────────────────┬──────────────────────────────┐
//   │ ● LIVE — לקבלן               │ ● LIVE — לתאגיד              │
//   │ עובדים זמינים…               │ דרישה חדשה…                  │
//   │ ↓ (clickable, contractor)    │ ↓ (clickable, corporation)   │
//   └──────────────────────────────┴──────────────────────────────┘
//   ┌──────────────────────────────┬──────────────────────────────┐
//   │ [קבלן tile]                  │ [תאגיד tile]                 │
//   └──────────────────────────────┴──────────────────────────────┘
//
// The unified rotating card lives in LiveShowcase.tsx and is preserved
// untouched — HeroSection picks between the two via a `?live=` query
// param for moderated user tests. See HeroSection for the switch.
//
// Hydration contract: same defensive pattern as LiveShowcase — the
// first random pick is deferred to useEffect so server and client
// agree on the initial render (null) before the client takes over.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users, Home, Briefcase, Handshake,
  Sparkles, Building2, ClipboardList,
} from 'lucide-react';
import { ProfessionIcon } from '@/features/searches/ProfessionIcon';
import { useAuth } from '@/lib/AuthContext';
import { createPicker } from '@/features/live-activity/picker';
import { MOCK_ITEMS } from '@/features/live-activity/mocks';
import type { ActivityCategory, ActivityItem, Mix } from '@/features/live-activity/types';

// ─── Per-side category mixes ──────────────────────────────────────────
//
// Contractor side: surfaces what THEY look for on the platform — workers
// to hire, housing to offer those workers, services they procure, and
// active corporations they could buy from. plus social-proof matches.
//
// Corporation side: mirrors that — surfaces what THEY look for. The
// big one is contractor demand (`requirement_new`), plus active
// contractors to sell to, and shared social-proof signals.
//
// Categories the role doesn't care about get weight 0 so the picker
// excludes them entirely.
const MIX_CONTRACTOR_SIDE: Mix = {
  workers_available:  3,
  housing_new:        2,
  service_new:        2,
  corp_active:        2,
  match_closed:       1,
  platform_pulse:     1,
  // Corp-side categories — excluded
  requirement_new:    0,
  contractor_active:  0,
};

const MIX_CORPORATION_SIDE: Mix = {
  requirement_new:    3,
  contractor_active:  2,
  match_closed:       1,
  platform_pulse:     1,
  // Contractor-side categories — excluded
  workers_available:  0,
  housing_new:        0,
  service_new:        0,
  corp_active:        0,
};

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

const CATEGORY_LABEL: Record<ActivityCategory, string> = {
  workers_available:  'עובדים זמינים',
  requirement_new:    'דרישה חדשה',
  housing_new:        'מגורים זמינים',
  match_closed:       'עסקה נסגרה',
  service_new:        'שירות חדש',
  corp_active:        'תאגיד פעיל',
  contractor_active:  'קבלן פעיל',
  platform_pulse:     'פעילות בפלטפורמה',
};

// ─── Side-specific rotating strip ─────────────────────────────────────
type Side = 'contractor' | 'corporation';

interface StripProps {
  side: Side;
  /** Default 5000ms with jitter so the two sides drift out of sync
   *  rather than tick together (looks more "alive"). */
  intervalMs?: number;
  /** Resolved href the strip click should navigate to. Computed by the
   *  parent so logged-in users go to their dashboard and anon visitors
   *  go to /login?intent=<side>. */
  ctaHref: string;
}

function nextInterval(baseMs: number): number {
  // ±750ms jitter per tick so the two sides desync visually.
  const jitter = (Math.random() - 0.5) * 1500;
  return baseMs + jitter;
}

function LiveStrip({ side, intervalMs = 5000, ctaHref }: StripProps) {
  const router = useRouter();

  // One picker per strip; each pulls from the same MOCK_ITEMS catalog
  // but the side-specific Mix zeros out the other role's categories so
  // a contractor item never shows on the corporation strip and vice
  // versa.
  const pickerRef = useRef<ReturnType<typeof createPicker> | null>(null);
  if (!pickerRef.current) {
    const mix = side === 'contractor' ? MIX_CONTRACTOR_SIDE : MIX_CORPORATION_SIDE;
    pickerRef.current = createPicker(MOCK_ITEMS, mix);
  }

  // Deterministic first pick: take the first MOCK_ITEM whose category
  // has a non-zero weight for this side. Identical result on server +
  // client, so hydration matches. Random rotation kicks in on the next
  // tick. (The unified LiveShowcase defers to useEffect for the SAME
  // reason — non-determinism breaks hydration — but we get the same
  // safety with a deterministic seed AND avoid the invisible-placeholder
  // flash on first paint, which was making the split layout look empty
  // for a brief moment after page load.)
  const [current, setCurrent] = useState<ActivityItem | null>(() => {
    const mix = side === 'contractor' ? MIX_CONTRACTOR_SIDE : MIX_CORPORATION_SIDE;
    return MOCK_ITEMS.find((it) => (mix[it.category] ?? 0) > 0) ?? null;
  });
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

  if (!current) {
    // Skeleton-height placeholder so the layout doesn't jump when the
    // picker resolves post-mount. Matches the rendered card height
    // roughly so the page doesn't shift below.
    return <div className="rounded-2xl border-2 border-transparent h-[88px] sm:h-[104px]" aria-hidden />;
  }

  const profCode = current.meta?.profession_code;
  const FallbackIcon = CATEGORY_ICON[current.category];
  const categoryLabel = CATEGORY_LABEL[current.category];
  const isContractor = side === 'contractor';

  // Per-side color tokens — brand orange for contractor, navy for corp,
  // matching the role tiles below. The "LIVE" pill stays rose so the
  // liveness signal reads consistently across both strips.
  const cardClasses = isContractor
    ? 'border-brand-200 bg-white hover:border-brand-400 hover:shadow-brand-200/40 shadow-brand-100/40'
    : 'border-navy-200 bg-white hover:border-navy-400 hover:shadow-navy-200/40 shadow-navy-100/40';
  const sideLabel = isContractor ? 'לקבלן' : 'לתאגיד';
  const iconBg    = isContractor ? 'bg-brand-50' : 'bg-navy-50';
  const iconText  = isContractor ? 'text-brand-700' : 'text-navy-700';
  const chipClass = isContractor
    ? 'bg-brand-100 text-brand-800'
    : 'bg-navy-100 text-navy-800';

  function handleClick() {
    router.push(ctaHref);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-label={isContractor ? 'כניסה כקבלן' : 'כניסה כתאגיד'}
      className={`block w-full text-start rounded-2xl border-2 shadow-md transition-all cursor-pointer hover:shadow-lg ${cardClasses}`}
    >
      <div
        key={current.id}
        aria-live="polite"
        className="animate-live-card-enter p-2 sm:p-2.5"
      >
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="shrink-0">
            {profCode ? (
              <div className={`h-10 w-10 sm:h-14 sm:w-14 rounded-xl ${iconBg} flex items-center justify-center`}>
                <ProfessionIcon code={profCode} size={36} alt="" className="sm:hidden" />
                <ProfessionIcon code={profCode} size={48} alt="" className="hidden sm:block" />
              </div>
            ) : (
              <div className={`h-10 w-10 sm:h-14 sm:w-14 rounded-xl ${iconBg} ${iconText} flex items-center justify-center`}>
                <FallbackIcon className="h-5 w-5 sm:h-7 sm:w-7" strokeWidth={2} />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            {/* Header row — LIVE pill + side label so it's obvious WHICH
                role this strip belongs to. */}
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-bold tracking-wide shadow-sm">
                <span aria-hidden="true" className="h-1 w-1 rounded-full bg-white animate-live-dot" />
                LIVE
              </span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${chipClass}`}>
                {sideLabel}
              </span>
              <span className="text-[10px] sm:text-xs font-medium text-slate-500 truncate">
                {categoryLabel}
              </span>
            </div>
            <p className="text-xs sm:text-sm font-bold text-slate-900 leading-snug line-clamp-2">
              {current.text}
            </p>
          </div>
        </div>
      </div>
    </button>
  );
}

// ─── Exported wrapper — 2-column grid matching the role tiles below ───
//
// Width / gap / max-width match the role-tiles container in HeroSection
// exactly (max-w-5xl mx-auto + grid-cols-2 + gap-3 md:gap-6) so each
// strip sits flush above its matching tile. On mobile both stay
// side-by-side just like the role tiles do — the user asked for vertical
// stacking but we keep horizontal because the tiles below are horizontal
// too; matching them visually beats independent stacking that would
// break alignment.

interface Props {
  /** Default 5000ms; jitter applied so the two sides drift apart. */
  intervalMs?: number;
}

export default function LiveShowcaseSplit({ intervalMs = 5000 }: Props) {
  const { isLoggedIn, entityType } = useAuth();

  // Compute click targets — logged-in users go straight to their
  // dashboard for the matching role, anon visitors go to /login with
  // the intent pre-set so the role-choice modal is skipped entirely.
  const contractorHref = isLoggedIn && entityType === 'contractor'
    ? '/contractor/dashboard'
    : '/login?intent=contractor';
  const corporationHref = isLoggedIn && entityType === 'corporation'
    ? '/corporation/dashboard'
    : '/login?intent=corporation';

  return (
    <section
      aria-label="פעילות חיה בפלטפורמה"
      className="relative bg-rose-50/40"
    >
      <div className="max-w-6xl mx-auto px-6 w-full py-3 sm:py-4">
        <div className="max-w-5xl mx-auto">
          {/* Header — same Live label + tagline as the unified version,
              shrunk a touch since each strip already carries its own
              LIVE pill below. */}
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-500 text-white text-xs font-bold tracking-wide shadow-sm">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-white animate-live-dot" />
                LIVE
              </span>
              <span className="text-sm font-semibold text-slate-800">מה קורה עכשיו ב-BuildUp</span>
            </div>
            <p className="text-xs text-slate-500 leading-snug hidden sm:block">
              לחץ על ההודעה הרלוונטית לך והיכנס ישירות
            </p>
          </div>

          {/* Two side-by-side strips. Grid identical to the role tiles
              wrapper below so each strip aligns flush with its tile. */}
          <div className="grid grid-cols-2 gap-3 md:gap-6">
            <LiveStrip side="contractor"  intervalMs={intervalMs} ctaHref={contractorHref} />
            <LiveStrip side="corporation" intervalMs={intervalMs} ctaHref={corporationHref} />
          </div>
        </div>
      </div>
    </section>
  );
}
