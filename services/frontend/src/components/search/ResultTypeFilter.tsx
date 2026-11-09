'use client';

import { Lock } from 'lucide-react';
import type { ResultType, ResultTypeValue } from '@/lib/api/search';

// R32 S4 · the segmented filter above the search results.
//
// Purely client-side: every count comes from the search response
// already in memory, so switching tabs costs no request. The value
// lives in the URL (`?type=`) and the page owns that sync — this
// component only reports a click.
//
// A type listed in `hiddenTypes` keeps its tab and shows a lock
// instead of a count. It stays selectable on purpose: the empty state
// behind it is where the visitor reads why, and what to do about it.
// `hiddenTypes` is server-derived from the viewer, never from a count,
// so a lock reveals nothing about what sits behind it.

export interface ResultTypeCounts {
  workers:  number;
  housing:  number;
  services: number;
}

const TABS: { value: ResultTypeValue; label: string }[] = [
  { value: 'all',      label: 'הכל' },
  { value: 'workers',  label: 'עובדים' },
  { value: 'housing',  label: 'דיור' },
  { value: 'services', label: 'שירותים נלווים' },
];

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

  const countFor = (tab: ResultTypeValue): number =>
    tab === 'all' ? total : counts[tab];

  return (
    <div
      role="tablist"
      aria-label="סינון תוצאות לפי סוג"
      className="result-type-filter relative flex items-stretch border-b border-slate-200"
    >
      {TABS.map((tab) => {
        const isLocked = tab.value !== 'all' && hidden.has(tab.value as ResultType);
        const isActive = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.value)}
            className={
              'flex-1 min-w-0 px-2 sm:px-3 pb-2.5 pt-1.5 text-center ' +
              'text-xs sm:text-sm font-semibold ' +
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 rounded-t-md ' +
              (isActive
                // brand-800 (#a5530b, 5.47:1 on white) — brand-600 is
                // the fill colour for the indicator, never label text
                // on a white surface.
                ? 'text-brand-800'
                : 'text-slate-600 hover:text-slate-900')
            }
          >
            <span className="block truncate">{tab.label}</span>
            <span className="result-type-filter__count mt-0.5 block text-[11px] font-normal text-slate-500">
              {isLocked ? (
                <>
                  <Lock className="inline-block h-3 w-3 align-[-1px]" aria-hidden="true" />
                  <span className="sr-only">נדרשת התחברות</span>
                </>
              ) : (
                countFor(tab.value)
              )}
            </span>
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
