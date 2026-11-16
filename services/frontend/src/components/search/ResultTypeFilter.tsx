'use client';

import { useId, useRef } from 'react';
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
// R38 item 4 · three candidate designs, chosen with `?tabs=a|b|c` on
// the page, so Yulian can compare them on staging. Without the flag the
// current design is shown. When one is chosen the other two and the
// flag go.
//
//   a  an icon per tab, the count as a round badge beside the label,
//      the underline kept
//   b  pills: the active tab on a light brand background, soft
//      transition; a tab with nothing in it is quieter and says why on
//      hover or focus
//   c  b, plus a bar that sticks under the search bar while scrolling,
//      and on a phone the tabs scroll sideways instead of squeezing

export interface ResultTypeCounts {
  workers:  number;
  housing:  number;
  services: number;
}

export type TabsVariant = 'a' | 'b' | 'c';

const TABS: { value: ResultTypeValue; label: string; Icon: typeof Users }[] = [
  { value: 'all',      label: 'הכל',           Icon: LayoutGrid },
  { value: 'workers',  label: 'עובדים',        Icon: Users },
  { value: 'housing',  label: 'דיור',          Icon: Home },
  { value: 'services', label: 'שירותים נלווים', Icon: Wrench },
];

// Why a tab is empty, for the quieter tabs of b and c. Short, and true
// for every query: the tab counts matches of this search only.
const EMPTY_HINT = 'אין תוצאות מהסוג הזה לחיפוש הזה';
const LOCKED_HINT = 'נדרשת התחברות';

export default function ResultTypeFilter({
  value,
  counts,
  hiddenTypes = [],
  onChange,
  variant,
}: {
  value:        ResultTypeValue;
  counts:       ResultTypeCounts;
  hiddenTypes?: ResultType[];
  onChange:     (next: ResultTypeValue) => void;
  variant?:     TabsVariant | null;
}) {
  const hidden = new Set<ResultType>(hiddenTypes);
  const total = counts.workers + counts.housing + counts.services;
  const activeIndex = Math.max(0, TABS.findIndex((t) => t.value === value));
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const hintId = useId();

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

  if (!variant) {
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
                  // brand-800 (#a5530b, 5.47:1 on white): brand-600 is
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
                    <span className="sr-only">{LOCKED_HINT}</span>
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

  const pills = variant === 'b' || variant === 'c';

  return (
    <div
      className={
        variant === 'c'
          // Sticks under the page's top edge while the results scroll.
          // The page has no fixed header on the results view, so 0.
          ? 'sticky top-0 z-20 -mx-1 bg-white/95 px-1 py-2 backdrop-blur supports-[backdrop-filter]:bg-white/80'
          : ''
      }
    >
      <div
        role="tablist"
        aria-label="סינון תוצאות לפי סוג"
        className={
          variant === 'a'
            ? 'result-type-filter relative flex items-stretch border-b border-slate-200'
            : variant === 'b'
              ? 'flex flex-wrap items-center gap-2'
              // c · one row that scrolls sideways on a phone
              : 'flex items-center gap-2 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
        }
      >
        {TABS.map((tab, i) => {
          const isLocked = tab.value !== 'all' && hidden.has(tab.value as ResultType);
          const isActive = tab.value === value;
          const count = countFor(tab.value);
          const isEmpty = !isLocked && count === 0;
          const quiet = pills && isEmpty && !isActive;
          const { Icon } = tab;

          const badge = isLocked ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-100 px-1 text-slate-500">
              <Lock className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only">{LOCKED_HINT}</span>
            </span>
          ) : (
            <span
              className={
                'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums ' +
                (isActive ? 'bg-brand-600 text-slate-900' : quiet ? 'bg-slate-50 text-slate-400' : 'bg-slate-100 text-slate-700')
              }
            >
              {count}
            </span>
          );

          return (
            <button
              key={tab.value}
              ref={(el) => { tabRefs.current[i] = el; }}
              type="button"
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              aria-describedby={pills && (isEmpty || isLocked) ? `${hintId}-${tab.value}` : undefined}
              onClick={() => onChange(tab.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={
                'group relative inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 text-sm font-semibold ' +
                'transition-colors duration-200 motion-reduce:transition-none ' +
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ' +
                (variant === 'a'
                  ? 'flex-1 min-w-0 rounded-t-md px-2 sm:px-3 ' + (isActive ? 'text-brand-800' : 'text-slate-600 hover:text-slate-900')
                  : 'rounded-full border px-3.5 ' +
                    (isActive
                      // brand-800 on brand-50: 5.2:1. Never brand-500 as text.
                      ? 'border-brand-200 bg-brand-50 text-brand-800'
                      : quiet
                        ? 'border-transparent bg-transparent text-slate-400 hover:text-slate-600'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'))
              }
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{tab.label}</span>
              {badge}
              {pills && (isEmpty || isLocked) && (
                <span
                  id={`${hintId}-${tab.value}`}
                  role="tooltip"
                  className="pointer-events-none absolute top-full z-30 mt-1.5 hidden whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-normal text-white shadow group-hover:block group-focus-visible:block"
                >
                  {isLocked ? LOCKED_HINT : EMPTY_HINT}
                </span>
              )}
            </button>
          );
        })}
        {variant === 'a' && (
          <span
            aria-hidden="true"
            className="result-type-filter__indicator"
            style={{
              ['--seg-i' as string]: String(activeIndex),
              ['--seg-count' as string]: String(TABS.length),
            }}
          />
        )}
      </div>
    </div>
  );
}
