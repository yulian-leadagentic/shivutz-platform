'use client';

// Role-targeted Live strip — shared by LiveShowcaseSplit (two standalone
// strips) and LiveShowcaseMerged (each strip fused with its role tile).
// Exports the per-role mixes + a presentational LiveStripContent that
// renders just the rotating content (LIVE pill + role chip + category +
// message text), no outer button/link wrapper. The consumer wraps it in
// whatever container fits — a button (Split) or the top half of a
// combined card (Merged).
//
// Hydration contract: first pick is DETERMINISTIC (first MOCK_ITEM whose
// category has a non-zero weight). Identical on server + client so the
// rendered HTML matches and React doesn't tear down event handlers.
// Random rotation kicks in on the next tick.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Users, Home, Briefcase, Handshake,
  Sparkles, Building2, ClipboardList,
} from 'lucide-react';
import { ProfessionIcon } from '@/features/searches/ProfessionIcon';
import { createPicker } from './picker';
import { MOCK_ITEMS } from './mocks';
import type { ActivityCategory, ActivityItem, Mix } from './types';

export type RoleSide = 'contractor' | 'corporation';

// ─── Per-side category mixes ──────────────────────────────────────────
//
// Contractor side: surfaces what THEY look for on the platform — workers
// to hire, housing to offer those workers, services they procure, and
// active corporations they could buy from. Plus shared social-proof.
//
// Corporation side: mirrors that — surfaces what THEY look for. Big one
// is contractor demand (`requirement_new`), plus active contractors to
// sell to, and shared social-proof signals.
//
// Categories the role doesn't care about get weight 0 so the picker
// excludes them entirely.
export const MIX_CONTRACTOR_SIDE: Mix = {
  workers_available:  3,
  housing_new:        2,
  service_new:        2,
  corp_active:        2,
  match_closed:       1,
  platform_pulse:     1,
  requirement_new:    0,
  contractor_active:  0,
};

export const MIX_CORPORATION_SIDE: Mix = {
  requirement_new:    3,
  contractor_active:  2,
  match_closed:       1,
  platform_pulse:     1,
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

function nextInterval(baseMs: number): number {
  // ±750ms jitter per tick so the two sides desync visually.
  const jitter = (Math.random() - 0.5) * 1500;
  return baseMs + jitter;
}

/**
 * Hook that owns the rotation state. Returns the current item plus
 * pause handlers so the consumer can suspend rotation on hover.
 */
export function useRoleLiveStrip(side: RoleSide, intervalMs = 5000) {
  const pickerRef = useRef<ReturnType<typeof createPicker> | null>(null);
  if (!pickerRef.current) {
    const mix = side === 'contractor' ? MIX_CONTRACTOR_SIDE : MIX_CORPORATION_SIDE;
    pickerRef.current = createPicker(MOCK_ITEMS, mix);
  }

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

  return {
    current,
    pause: () => setPaused(true),
    resume: () => setPaused(false),
  };
}

// ─── Presentational strip content ─────────────────────────────────────
//
// Renders the LIVE pill + role chip + category + message text + icon.
// No outer button/link — the consumer wraps this in whatever click
// target fits (full-card link for merged, dedicated button for split).
//
// `compact=true` shrinks paddings + icon size for the merged variant
// where the strip is the smaller upper portion of a combined card.

export function LiveStripContent({
  side,
  current,
  compact = false,
}: {
  side: RoleSide;
  current: ActivityItem;
  compact?: boolean;
}) {
  const isContractor = side === 'contractor';
  const profCode = current.meta?.profession_code;
  const FallbackIcon = CATEGORY_ICON[current.category];
  const categoryLabel = CATEGORY_LABEL[current.category];
  const sideLabel = isContractor ? 'לקבלן' : 'לתאגיד';
  const iconBg    = isContractor ? 'bg-brand-50'  : 'bg-navy-50';
  const iconText  = isContractor ? 'text-brand-700' : 'text-navy-700';
  const chipClass = isContractor
    ? 'bg-brand-100 text-brand-800'
    : 'bg-navy-100 text-navy-800';

  const iconBox = compact
    ? 'h-9 w-9 sm:h-11 sm:w-11 rounded-lg'
    : 'h-10 w-10 sm:h-14 sm:w-14 rounded-xl';
  const iconSize = compact ? { sm: 30, md: 40 } : { sm: 36, md: 48 };
  const padding = compact ? 'p-2 sm:p-2.5' : 'p-2 sm:p-2.5';

  return (
    <div
      key={current.id}
      aria-live="polite"
      className={`animate-live-card-enter ${padding}`}
    >
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="shrink-0">
          {profCode ? (
            <div className={`${iconBox} ${iconBg} flex items-center justify-center`}>
              <ProfessionIcon code={profCode} size={iconSize.sm} alt="" className="sm:hidden" />
              <ProfessionIcon code={profCode} size={iconSize.md} alt="" className="hidden sm:block" />
            </div>
          ) : (
            <div className={`${iconBox} ${iconBg} ${iconText} flex items-center justify-center`}>
              <FallbackIcon className={compact ? 'h-4 w-4 sm:h-5 sm:w-5' : 'h-5 w-5 sm:h-7 sm:w-7'} strokeWidth={2} />
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
          <p className={`${compact ? 'text-xs sm:text-sm' : 'text-xs sm:text-sm'} font-bold text-slate-900 leading-snug line-clamp-2`}>
            {current.text}
          </p>
        </div>
      </div>
    </div>
  );
}
