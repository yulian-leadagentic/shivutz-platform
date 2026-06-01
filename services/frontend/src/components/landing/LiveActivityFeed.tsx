'use client';

// Live-activity feed — landing-page strip that surfaces "what's
// happening on the portal right now." Phase 1 is mock-only (see
// ../../features/live-activity/mocks.ts); Phase 2 swaps the source for
// GET /api/marketplace/activity-feed. The view doesn't care which.
//
// Layout:
//   ┌──────────────────────────────────────────────────────────────┐
//   │ ● Live · עכשיו בפלטפורמה                          ‹ ›       │
//   ├──────────────────────────────────────────────────────────────┤
//   │ [icon] <message text>                       [CTA]           │
//   │        לפני N דק׳                                            │
//   └──────────────────────────────────────────────────────────────┘
//
// Auto-advances every ~5s (±0.5s jitter). Pauses on hover (desktop)
// and when the tab is hidden. Honours prefers-reduced-motion: animation
// is suppressed via globals.css.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ChevronLeft, ChevronRight, ArrowLeft, Users, Home,
  Briefcase, Handshake, Sparkles, Building2, ClipboardList,
} from 'lucide-react';
import { ProfessionIcon } from '@/features/searches/ProfessionIcon';
import { useAuth } from '@/lib/AuthContext';
import { createPicker } from '@/features/live-activity/picker';
import { MIX_BY_ROLE, MOCK_ITEMS } from '@/features/live-activity/mocks';
import type { ActivityItem, AudienceRole } from '@/features/live-activity/types';
import { resolveCta } from '@/features/live-activity/ctas';

// Picks an audience bucket for the mix. Anonymous visitors are the
// dominant landing-page audience; logged-in visitors get a feed slanted
// to their role.
function audienceFor(entityType: 'contractor' | 'corporation' | null): AudienceRole {
  return entityType ?? 'anon';
}

// Lucide fallback per category — used when an item has no profession
// icon to anchor on (e.g. housing, services, platform pulse).
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

// Relative time formatter. Recomputed on every render so the badge
// quietly ages as the user lingers on the page. Bounded buckets so we
// don't surface a misleading exact minute count.
function formatTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1)  return 'הרגע';
  if (mins < 60) return `לפני ${mins} דק׳`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `לפני ${hours} שע׳`;
  return 'לפני יום';
}

// Default ~5s with ±0.5s jitter (so two visitors on the same machine
// aren't perfectly synchronised). Caller can override.
function nextInterval(baseMs: number): number {
  const jitter = (Math.random() - 0.5) * 1000;  // [-500, +500] ms
  return baseMs + jitter;
}

interface Props {
  /** Auto-advance interval in ms. Default 5000; clamped to [4000, 6000]
   *  per spec but jitter is applied on top so the actual range is
   *  ~[3.5s, 6.5s] per cycle. */
  intervalMs?: number;
}

export default function LiveActivityFeed({ intervalMs = 5000 }: Props) {
  const auth     = useAuth();
  const role     = audienceFor(auth.entityType);

  // Picker is created lazily once per mount. Re-created on role change
  // so the rotation re-weights when the user logs in / switches entity.
  const pickerRef = useRef<ReturnType<typeof createPicker> | null>(null);
  if (!pickerRef.current) {
    pickerRef.current = createPicker(MOCK_ITEMS, MIX_BY_ROLE[role]);
  }
  const lastRoleRef = useRef<AudienceRole>(role);
  if (lastRoleRef.current !== role) {
    pickerRef.current = createPicker(MOCK_ITEMS, MIX_BY_ROLE[role]);
    lastRoleRef.current = role;
  }

  const [current, setCurrent] = useState<ActivityItem | null>(
    () => pickerRef.current!.next(),
  );
  // `paused` covers BOTH user hover (desktop) and the document being
  // hidden (visibilitychange). The interval restarts cleanly when paused
  // flips back to false.
  const [paused, setPaused] = useState(false);

  const advance = useCallback(() => {
    const next = pickerRef.current?.next();
    if (next) setCurrent(next);
  }, []);

  // Rotation interval. The dependency on `paused` + `current` is fine:
  // every state change cleans up the timer and re-schedules.
  useEffect(() => {
    if (paused || !current) return;
    const t = setTimeout(advance, nextInterval(intervalMs));
    return () => clearTimeout(t);
  }, [advance, current, intervalMs, paused]);

  // Pause when the tab is hidden to avoid background timer drift +
  // wasted re-renders on phones. visibilitychange covers both backgrounding
  // the tab and locking the device screen.
  useEffect(() => {
    function onVisibility() { setPaused(document.visibilityState === 'hidden'); }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  if (!current) return null;

  const cta = resolveCta(current.cta_intent, role);
  const profCode = current.meta?.profession_code;
  const FallbackIcon = CATEGORY_ICON[current.category];

  return (
    <section
      aria-label="פעילות אחרונה בפלטפורמה"
      className="bg-white border-y border-slate-100 py-8"
    >
      <div className="max-w-4xl mx-auto px-4 sm:px-6">

        {/* Header strip — Live label + manual chevrons */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full bg-rose-500 animate-live-dot"
            />
            <span className="font-bold text-slate-700">Live</span>
            <span className="text-slate-300">·</span>
            <span className="text-slate-500">עכשיו בפלטפורמה</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={advance}
              aria-label="הצעה קודמת"
              className="h-7 w-7 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors inline-flex items-center justify-center"
            >
              {/* In RTL the "previous" chevron points to the start side */}
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={advance}
              aria-label="הצעה הבאה"
              className="h-7 w-7 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors inline-flex items-center justify-center"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Rotating card — key={current.id} forces a remount so the
            enter animation runs on every swap. aria-live="polite" so
            screen readers announce updates without interrupting. */}
        <div
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          className="relative rounded-2xl border border-slate-200 bg-white/95 shadow-sm hover:shadow-md transition-shadow"
        >
          <div
            key={current.id}
            aria-live="polite"
            className="animate-live-card-enter p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5"
          >
            {/* Icon — profession illustration if we have one, else a
                category-themed Lucide glyph in a soft circle. */}
            <div className="shrink-0 self-start sm:self-center">
              {profCode ? (
                <div className="h-12 w-12 sm:h-14 sm:w-14 rounded-2xl bg-brand-50 flex items-center justify-center">
                  <ProfessionIcon code={profCode} size={44} alt="" />
                </div>
              ) : (
                <div className="h-12 w-12 sm:h-14 sm:w-14 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center">
                  <FallbackIcon className="h-6 w-6 sm:h-7 sm:w-7" strokeWidth={2.2} />
                </div>
              )}
            </div>

            {/* Body — text + relative time */}
            <div className="flex-1 min-w-0">
              <p className="text-sm sm:text-base font-semibold text-slate-900 leading-snug">
                {current.text}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {formatTimeAgo(current.occurred_at)}
              </p>
            </div>

            {/* CTA — hidden when the intent doesn't fit the user's role
                (e.g. a corp user shouldn't see "post requirement"). */}
            {!cta.hidden && cta.label && (
              <Link
                href={cta.href}
                className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-brand-600 text-sm font-bold text-white shadow-sm hover:bg-brand-700 transition-colors self-start sm:self-center"
              >
                {cta.label}
                <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
              </Link>
            )}
          </div>
        </div>

        {/* Quiet caption — sells the "you're seeing real activity" angle
            without being shouty. */}
        <p className="text-xs text-slate-400 text-center mt-3">
          רואים פה דוגמה לפעילות שמתרחשת בפלטפורמה
        </p>

      </div>
    </section>
  );
}
