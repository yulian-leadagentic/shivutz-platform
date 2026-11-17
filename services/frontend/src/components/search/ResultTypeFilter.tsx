'use client';

import { useRef } from 'react';
import { Home, LayoutGrid, Lock, Users, Wrench } from 'lucide-react';
import type { ResultType, ResultTypeValue } from '@/lib/api/search';

// R32 S4 · the segmented filter above the search results.
//
// Purely client-side: every count comes from the search response
// already in memory, so switching tabs costs no request. The value
// lives in the URL (`?type=`) and the page owns that sync; this
// component only reports a click.
//
// A type listed in `hiddenTypes` keeps its tab and shows a lock
// instead of a count. It stays selectable on purpose: the empty state
// behind it is where the visitor reads why, and what to do about it.
// `hiddenTypes` is server-derived from the viewer, never from a count,
// so a lock reveals nothing about what sits behind it.
//
// R38 item 4 · design A, chosen by Yulian on 17.11: an icon per tab,
// the count as a round badge beside the label, and the sliding
// underline.

export interface ResultTypeCounts {
  workers:  number;
  housing:  number;
  services: number;
}

const TABS: { value: ResultTypeValue; label: string; Icon: typeof Users }[] = [
  { value: 'all',      label: 'הכל',           Icon: LayoutGrid },
  { value: 'workers',  label: 'עובדים',        Icon: Users },
  { value: 'housing',  label: 'דיור',          Icon: Home },
  { value: 'services', label: 'שירותים נלווים', Icon: Wrench },
];

const LOCKED_HINT = 'נדרשת התחברות';

export default function ResultTypeFilter({
  value,
  counts,
  hiddenTypes = [],
  onChange,
}: {
  value:        ResultTypeValue;
  counts:       ResultTypeCounts;
  hiddenTypes?: ResultType[];
  onChange:     (next: ResultTypeValue) => void;
}) {
  const hidden = new Set<ResultType>(hiddenTypes);
  const total = counts.workers + counts.housing + counts.services;
  const activeIndex = Math.max(0, TABS.findIndex((t) => t.value === value));
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const countFor = (tab: ResultTypeValue): number =>
    tab === 'all' ? total : counts[tab];

  // Arrow keys move between tabs (WAI-ARIA tabs pattern). In RTL the
  // visual order runs right to left, so ArrowLeft is "next".
  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const rtl = typeof document !== 'undefined' && document.dir === 'rtl';
    const step = e.key === 'ArrowLeft' ? (rtl ? 1 : -1) : e.key === 'ArrowRight' ? (rtl ? -1 : 1) : 0;
    let next = index;
    if (step) next = (index + step + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    else return;
    e.preventDefault();
    tabRefs.current[next]?.focus();
    onChange(TABS[next].value);
  }

  return (
    <div
      role="tablist"
      aria-label="סינון תוצאות לפי סוג"
      className="result-type-filter relative flex items-stretch border-b border-slate-200"
    >
      {TABS.map((tab, i) => {
        const isLocked = tab.value !== 'all' && hidden.has(tab.value as ResultType);
        const isActive = tab.value === value;
        const { Icon } = tab;
        return (
          <button
            key={tab.value}
            ref={(el) => { tabRefs.current[i] = el; }}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={
              'relative inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-t-md px-2 sm:px-3 ' +
              'text-sm font-semibold transition-colors duration-200 motion-reduce:transition-none ' +
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ' +
              // brand-800 (#a5530b, 5.47:1 on white): brand-600 is the
              // fill colour for the indicator, never label text on white.
              (isActive ? 'text-brand-800' : 'text-slate-600 hover:text-slate-900')
            }
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{tab.label}</span>
            {isLocked ? (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-100 px-1 text-slate-500">
                <Lock className="h-3 w-3" aria-hidden="true" />
                <span className="sr-only">{LOCKED_HINT}</span>
              </span>
            ) : (
              <span
                className={
                  'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums ' +
                  (isActive ? 'bg-brand-600 text-slate-900' : 'bg-slate-100 text-slate-700')
                }
              >
                {countFor(tab.value)}
              </span>
            )}
          </button>
        );
      })}
      {/* One element for the active marker, moved with a transform so
          the slide costs no layout. `--seg-dir` flips the direction in
          RTL (globals.css); `--seg-count` keeps the maths honest if a
          fifth tab ever lands here. */}
      <span
        aria-hidden="true"
        className="result-type-filter__indicator"
        style={{
          ['--seg-i' as string]: String(activeIndex),
          ['--seg-count' as string]: String(TABS.length),
        }}
      />
    </div>
  );
}
