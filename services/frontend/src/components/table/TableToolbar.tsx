'use client';

/**
 * Shared filter + sort toolbar for tabular screens.
 *
 * One component, many shapes — every table page in the app calls
 * <TableToolbar> with the subset of props it needs:
 *
 *   - <pills> for the primary axis (status, role, type, etc.). Each
 *     pill optionally carries a count badge.
 *   - <selects> for secondary dropdown filters (multi-value buckets
 *     that don't fit as pills — profession, country, etc.).
 *   - <searchValue> + <onSearchChange> for free-text filtering.
 *   - <sortOptions> + <sortKey>/<sortDir> for a sort dropdown with
 *     direction toggle.
 *   - <onClear> renders a "נקה סינון" button when any filter is active.
 *
 * Modeled after /admin/deals — the proven pattern in production —
 * but extracted so we don't re-implement the same chips/search/sort
 * dance in 17 different files.
 */

import { useEffect, type ReactNode } from 'react';
import { ArrowUp, ArrowDown, Filter as FilterIcon, X, Search } from 'lucide-react';

export interface PillOption<K extends string = string> {
  key: K;
  label: string;
  count?: number;
  /** Tailwind class for the ACTIVE state of this pill. The 'all' pill
   *  is usually slate-900; semantic pills get amber/sky/rose/emerald
   *  depending on what they mean. */
  tone?: string;
}

export interface SelectFilterOption {
  value: string;
  label: string;
}

export interface SelectFilter {
  key: string;                              // for React keys
  ariaLabel: string;                        // 'מקצוע', 'מדינת מוצא'
  value: string;
  onChange: (next: string) => void;
  options: SelectFilterOption[];            // include the "all" choice
}

export interface SortOption<S extends string = string> {
  key: S;
  label: string;
}

interface Props<P extends string = string, S extends string = string> {
  /** Filter pills row (renders above the control row when present). */
  pills?: {
    options: PillOption<P>[];
    active:  P;
    onChange: (next: P) => void;
  };
  /** Dropdown filters that sit inside the control row. */
  selects?: SelectFilter[];
  /** Free-text search input. Pass empty string to disable. */
  searchValue?: string;
  onSearchChange?: (next: string) => void;
  searchPlaceholder?: string;
  /** Sort dropdown + direction toggle. */
  sortOptions?: SortOption<S>[];
  sortKey?:   S;
  sortDir?:   'asc' | 'desc';
  onSortKeyChange?: (next: S) => void;
  onSortDirToggle?: () => void;
  /** "Clear filters" callback — when provided AND any filter is
   *  active (caller decides), a clear button renders. */
  hasActiveFilter?: boolean;
  onClear?: () => void;
  /** Optional Enter-key handler on the search input (for pages that
   *  submit search server-side rather than filter locally). */
  onSearchSubmit?: () => void;
  /** Optional trailing element rendered at the end of the control
   *  strip (e.g. an "include hidden" checkbox). Kept as an escape
   *  hatch so page-specific extras don't need bespoke toolbars. */
  trailingControls?: ReactNode;
}

export function TableToolbar<P extends string = string, S extends string = string>(
  props: Props<P, S>,
) {
  const {
    pills,
    selects,
    searchValue,
    onSearchChange,
    searchPlaceholder = 'חיפוש...',
    sortOptions,
    sortKey,
    sortDir,
    onSortKeyChange,
    onSortDirToggle,
    hasActiveFilter,
    onClear,
    onSearchSubmit,
    trailingControls,
  } = props;

  const showSearch  = onSearchChange !== undefined;
  const showSort    = sortOptions && sortOptions.length > 0 && onSortKeyChange;
  const showSelects = selects && selects.length > 0;
  const showControl = showSearch || showSort || showSelects || hasActiveFilter || !!trailingControls;

  // QA-R5 — global "/" focuses the table search. Skipped when the
  // user is already typing in a form field (input/textarea/contentE)
  // so it doesn't hijack normal Hebrew/English typing. Each toolbar
  // installs its own listener but the `data-table-search` attribute
  // is unique-per-toolbar so only ONE input gains focus even with
  // multiple tables on the page (rare).
  useEffect(() => {
    if (!showSearch) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== '/') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable) return;
      const el = document.querySelector<HTMLInputElement>('input[data-table-search="true"]');
      if (!el) return;
      e.preventDefault();
      el.focus();
      el.select();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showSearch]);

  return (
    <div className="space-y-3">
      {pills && (
        <div className="flex gap-2 flex-wrap">
          {pills.options.map((f) => {
            const active = pills.active === f.key;
            const tone = f.tone || 'bg-slate-900 text-white';
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => pills.onChange(f.key)}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  active
                    ? tone + ' border-transparent'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {f.count !== undefined && (
                  <span
                    className={`text-xs font-bold px-1.5 py-0.5 rounded-full leading-none ${
                      active ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {f.count}
                  </span>
                )}
                <span>{f.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {showControl && (
        // M3.3 — the row USED to be a single-line strip with
        // overflow-x-auto ("narrow viewports get horizontal scroll").
        // That made mobile pages carry an internal scrollbar to reach
        // sort/filter, which nobody discovers. Now the strip stacks
        // VERTICALLY on ≤sm (each control full-width, ≥44px tall) and
        // stays a single row on sm+. Same controls, both viewports.
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 p-2 sm:overflow-x-auto">
            <FilterIcon className="hidden sm:block h-4 w-4 text-slate-400 shrink-0" />

            {showSelects && selects.map((s) => (
              <select
                key={s.key}
                aria-label={s.ariaLabel}
                value={s.value}
                onChange={(e) => s.onChange(e.target.value)}
                className="w-full sm:w-auto min-h-11 sm:h-9 text-sm border border-slate-300 rounded-md px-3 sm:px-2 bg-white sm:shrink-0 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              >
                {s.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ))}

            {showSearch && (
              // The search is the ONLY element that flex-grows. On
              // very narrow viewports it'll shrink to its min-width
              // and the toolbar gets a horizontal scrollbar.
              // QA-R5 — pressing "/" anywhere on the page focuses this
              // input (see the global useEffect below); Esc inside
              // the input clears it. The data-table-search attribute
              // is the marker the global handler looks for.
              <div className="relative w-full sm:flex-1 sm:min-w-[140px]">
                <Search className="h-4 w-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5 pointer-events-none" />
                <input
                  type="search"
                  data-table-search="true"
                  placeholder={searchPlaceholder}
                  value={searchValue || ''}
                  onChange={(e) => onSearchChange?.(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' && searchValue) {
                      e.stopPropagation();
                      onSearchChange?.('');
                    } else if (e.key === 'Enter' && onSearchSubmit) {
                      e.preventDefault();
                      onSearchSubmit();
                    }
                  }}
                  className="min-h-11 sm:h-9 w-full ps-8 pe-2 text-sm rounded-md border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                />
                <span
                  className="absolute end-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-300 font-mono pointer-events-none select-none hidden sm:inline-block"
                  aria-hidden
                >
                  /
                </span>
              </div>
            )}

            {showSort && (
              // Sort key + direction toggle. Mobile: sit on their own
              // row (`flex gap-2`), the select flex-grows so both fit
              // side by side without overflow. Desktop: unchanged
              // inline behavior.
              <div className="flex gap-2 sm:contents">
                <select
                  aria-label="מיון לפי"
                  value={sortKey}
                  onChange={(e) => onSortKeyChange?.(e.target.value as S)}
                  className="flex-1 sm:flex-none min-h-11 sm:h-9 text-sm border border-slate-300 rounded-md px-3 sm:px-2 bg-white sm:shrink-0 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                >
                  {sortOptions.map((o) => (
                    <option key={o.key} value={o.key}>{o.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={onSortDirToggle}
                  aria-label={sortDir === 'asc' ? 'סדר עולה' : 'סדר יורד'}
                  title={sortDir === 'asc' ? 'סדר עולה' : 'סדר יורד'}
                  className="min-h-11 min-w-11 sm:h-9 sm:w-9 inline-flex items-center justify-center rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-600 shrink-0"
                >
                  {sortDir === 'asc'
                    ? <ArrowUp className="h-4 w-4" />
                    : <ArrowDown className="h-4 w-4" />}
                </button>
              </div>
            )}

            {hasActiveFilter && onClear && (
              <button
                type="button"
                onClick={onClear}
                className="w-full sm:w-auto min-h-11 sm:h-9 inline-flex items-center justify-center sm:justify-start gap-1 px-3 text-sm font-medium rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 sm:shrink-0"
              >
                <X className="h-3.5 w-3.5" />
                נקה
              </button>
            )}

            {trailingControls && (
              <div className="shrink-0 flex items-center">{trailingControls}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Click-to-sort column header. Drop into a <thead> row in place of
 * a normal <th>. The active column shows its direction arrow; click
 * again to flip direction (caller handles via toggleSort()).
 */
export function SortableTh<S extends string = string>({
  label, sortBy, currentKey, currentDir, onClick, align = 'start', className = '',
}: {
  label:      string;
  sortBy:     S;
  currentKey: S;
  currentDir: 'asc' | 'desc';
  onClick:    (k: S) => void;
  align?:     'start' | 'center' | 'end';
  className?: string;
}) {
  const active = currentKey === sortBy;
  const Arrow = currentDir === 'asc' ? ArrowUp : ArrowDown;
  const alignClass = align === 'center' ? 'text-center' : align === 'end' ? 'text-end' : 'text-start';
  return (
    <th className={`py-2.5 px-3 font-bold ${alignClass} ${className}`}>
      <button
        type="button"
        onClick={() => onClick(sortBy)}
        className={`inline-flex items-center gap-1 hover:text-brand-700 ${active ? 'text-brand-700' : ''}`}
      >
        {label}
        {active && <Arrow className="h-3 w-3" />}
      </button>
    </th>
  );
}
