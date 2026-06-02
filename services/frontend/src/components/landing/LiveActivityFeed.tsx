'use client';

// Live-activity bubble — a floating notification that pops up from the
// bottom corner, holds for a few seconds, slides away, then the next
// one appears. Phase 1 uses local mock data (../../features/live-activity);
// Phase 2 swaps the source to GET /api/marketplace/activity-feed without
// touching this file.
//
// Lifecycle of a single bubble:
//   idle (gap)
//     ↓  picker.next() pulls a new item
//   entering (350ms)  — slide up + fade in
//     ↓
//   shown (~6s, paused on hover or tab-hidden)
//     ↓
//   exiting (300ms) — slide down + fade out
//     ↓
//   idle (~3s gap)
//     ↓ loop
//
// Designed to be unobtrusive: bottom-corner, max-w-sm, glassy white,
// close button for users who want to skip ahead. Auto-pauses on hover
// so a curious user has time to read before the CTA disappears.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  X, ArrowLeft, Users, Home, Briefcase, Handshake,
  Sparkles, Building2, ClipboardList,
} from 'lucide-react';
import { ProfessionIcon } from '@/features/searches/ProfessionIcon';
import { useAuth } from '@/lib/AuthContext';
import { createPicker } from '@/features/live-activity/picker';
import { MIX_BY_ROLE, MOCK_ITEMS } from '@/features/live-activity/mocks';
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

// Per-category accent — paints the icon backplate + the CTA so each
// bubble's tone matches its content (housing reads green, requirements
// read amber, etc.). Keeps the feed varied across rotations.
const CATEGORY_ACCENT: Record<keyof typeof CATEGORY_ICON, {
  iconBg: string; iconText: string; cta: string; rail: string;
}> = {
  workers_available: { iconBg: 'bg-brand-50',  iconText: 'text-brand-700',  cta: 'text-brand-700  hover:text-brand-800',  rail: 'bg-brand-500'  },
  requirement_new:   { iconBg: 'bg-amber-50',  iconText: 'text-amber-700',  cta: 'text-amber-700  hover:text-amber-800',  rail: 'bg-amber-500'  },
  housing_new:       { iconBg: 'bg-emerald-50',iconText: 'text-emerald-700',cta: 'text-emerald-700 hover:text-emerald-800',rail: 'bg-emerald-500'},
  match_closed:      { iconBg: 'bg-emerald-50',iconText: 'text-emerald-700',cta: 'text-emerald-700 hover:text-emerald-800',rail: 'bg-emerald-500'},
  service_new:       { iconBg: 'bg-sky-50',    iconText: 'text-sky-700',    cta: 'text-sky-700    hover:text-sky-800',    rail: 'bg-sky-500'    },
  corp_active:       { iconBg: 'bg-navy-50',   iconText: 'text-navy-700',   cta: 'text-navy-700   hover:text-navy-800',   rail: 'bg-navy-500'   },
  contractor_active: { iconBg: 'bg-brand-50',  iconText: 'text-brand-700',  cta: 'text-brand-700  hover:text-brand-800',  rail: 'bg-brand-500'  },
  platform_pulse:    { iconBg: 'bg-slate-100', iconText: 'text-slate-700',  cta: 'text-slate-700  hover:text-slate-900',  rail: 'bg-slate-400'  },
};

function formatTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1)  return 'הרגע';
  if (mins < 60) return `לפני ${mins} דק׳`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `לפני ${hours} שע׳`;
  return 'לפני יום';
}

// Phase durations (ms). Tuned so the bubble feels alive but doesn't
// pressure the visitor — 6s is long enough to read a Hebrew sentence
// without rushing, and the 3s gap means the screen isn't constantly
// flashing notifications.
const ENTER_MS = 350;
const SHOWN_MS = 6000;
const EXIT_MS  = 300;
const IDLE_MS  = 3000;
const INITIAL_DELAY_MS = 1200;   // wait a beat after page load before first bubble

type Phase = 'idle' | 'entering' | 'shown' | 'exiting';

export default function LiveActivityFeed() {
  const auth = useAuth();
  const role = audienceFor(auth.entityType);

  // Picker is recreated when the audience role changes (login / entity
  // switch) so weighting follows the user. Kept in a ref so re-renders
  // don't reshuffle the rotation mid-cycle.
  const pickerRef = useRef<ReturnType<typeof createPicker> | null>(null);
  const lastRoleRef = useRef<AudienceRole>(role);
  if (!pickerRef.current || lastRoleRef.current !== role) {
    pickerRef.current = createPicker(MOCK_ITEMS, MIX_BY_ROLE[role]);
    lastRoleRef.current = role;
  }

  const [phase, setPhase] = useState<Phase>('idle');
  const [current, setCurrent] = useState<ActivityItem | null>(null);
  // `paused` covers BOTH hover and the document being hidden.
  const [paused, setPaused] = useState(false);
  // Track whether we've completed the initial mount delay. Prevents the
  // SSR markup from briefly flashing a bubble before the entrance
  // animation has had a chance to play.
  const [mounted, setMounted] = useState(false);

  const advance = useCallback(() => {
    const next = pickerRef.current?.next();
    if (next) {
      setCurrent(next);
      setPhase('entering');
    }
  }, []);

  // First-bubble delay so it doesn't pop up the same instant the page
  // paints — feels more natural to see it appear after the visitor's
  // eye has settled on the hero.
  useEffect(() => {
    const t = setTimeout(() => {
      setMounted(true);
      advance();
    }, INITIAL_DELAY_MS);
    return () => clearTimeout(t);
  }, [advance]);

  // Phase machine. Each phase schedules its own transition; when paused
  // (hover or tab hidden) the timer doesn't run, so the bubble stays on
  // screen as long as the visitor's mouse is over it.
  useEffect(() => {
    if (!mounted || paused) return;
    let timer: ReturnType<typeof setTimeout>;
    if (phase === 'entering') {
      timer = setTimeout(() => setPhase('shown'), ENTER_MS);
    } else if (phase === 'shown') {
      timer = setTimeout(() => setPhase('exiting'), SHOWN_MS);
    } else if (phase === 'exiting') {
      timer = setTimeout(() => setPhase('idle'), EXIT_MS);
    } else {
      // idle → next bubble
      timer = setTimeout(advance, IDLE_MS);
    }
    return () => clearTimeout(timer);
  }, [advance, mounted, paused, phase]);

  // Pause the rotation while the tab is in the background so we don't
  // burn the visitor's first impression on a bubble they never saw.
  useEffect(() => {
    function onVis() { setPaused(document.visibilityState === 'hidden'); }
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  function skipToNext() {
    // Move straight to the exit animation; the phase machine handles
    // the idle gap + next bubble on its own.
    if (phase === 'shown' || phase === 'entering') setPhase('exiting');
  }

  // Render-time guards — render NOTHING until first bubble is ready so
  // SSR output is empty and there's no hydration flash.
  if (!mounted || !current) return null;

  const accent = CATEGORY_ACCENT[current.category];
  const cta = resolveCta(current.cta_intent, role);
  const profCode = current.meta?.profession_code;
  const FallbackIcon = CATEGORY_ICON[current.category];

  const visible = phase === 'entering' || phase === 'shown';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="עדכון פעילות חי"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      // Positioned at the start-bottom corner (RTL: right-bottom).
      // Wider z-index than LandingNav (z-30) but lower than modals.
      // `pointer-events-none` while invisible so a hidden bubble doesn't
      // eat clicks on whatever sits underneath it (e.g. footer links).
      className={`
        fixed z-40 bottom-4 sm:bottom-6 start-4 sm:start-6
        w-[calc(100vw-2rem)] max-w-sm
        transform-gpu transition-all ease-out
        ${visible
          ? 'opacity-100 translate-y-0 duration-300'
          : 'opacity-0 translate-y-6 pointer-events-none duration-200'}
      `}
    >
      {/* The bubble itself. Solid white over a soft backdrop-blur so it
          reads cleanly over photos/dark hero in any context. */}
      <div className="relative rounded-2xl bg-white/95 backdrop-blur-sm shadow-2xl shadow-slate-900/10 ring-1 ring-slate-200 overflow-hidden">

        {/* Coloured accent rail along the top edge — picks up the
            category accent so each bubble reads with its own tone
            without painting the whole card. */}
        <div className={`h-1 w-full ${accent.rail}`} aria-hidden="true" />

        {/* Close (skip) button — top-end corner */}
        <button
          type="button"
          onClick={skipToNext}
          aria-label="הצג עדכון הבא"
          className="absolute top-2 end-2 h-6 w-6 rounded-full text-slate-300 hover:text-slate-600 hover:bg-slate-100 transition-colors inline-flex items-center justify-center"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        <div className="px-4 pt-3 pb-4 sm:px-5 sm:pt-3.5 sm:pb-4">
          {/* Header strip — Live dot + label */}
          <div className="flex items-center gap-1.5 mb-2.5">
            <span className="relative inline-flex h-2 w-2 items-center justify-center">
              <span className="absolute inline-flex h-full w-full rounded-full bg-rose-500 animate-live-dot" />
              <span className="absolute inline-flex h-full w-full rounded-full animate-live-dot-halo" />
            </span>
            <span className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-slate-500">
              Live
            </span>
            <span className="text-[10px] text-slate-300">·</span>
            <span className="text-[10px] text-slate-400">{formatTimeAgo(current.occurred_at)}</span>
          </div>

          {/* Content row — icon + body */}
          <div className="flex items-start gap-3">
            <div className={`shrink-0 h-11 w-11 rounded-xl ${accent.iconBg} flex items-center justify-center`}>
              {profCode ? (
                <ProfessionIcon code={profCode} size={36} alt="" />
              ) : (
                <FallbackIcon className={`h-5 w-5 ${accent.iconText}`} strokeWidth={2.2} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900 leading-snug">
                {current.text}
              </p>
              {!cta.hidden && cta.label && (
                <Link
                  href={cta.href}
                  className={`mt-1.5 inline-flex items-center gap-1 text-xs font-bold ${accent.cta} transition-colors`}
                >
                  {cta.label}
                  <ArrowLeft className="h-3 w-3" />
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
