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
  } = props;

  const showSearch  = onSearchChange !== undefined;
  const showSort    = sortOptions && sortOptions.length > 0 && onSortKeyChange;
  const showSelects = selects && selects.length > 0;
  const showControl = showSearch || showSort || showSelects || hasActiveFilter;

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
        // Single-row control strip — never wraps. Narrow viewports get
        // horizontal scroll instead of breaking into 3 rows. All
        // children are h-9 so the row reads as one continuous bar.
        // The bg-white + border + rounded-lg replaces the previous
        // Card wrapper for a tighter footprint.
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
          <div className="flex items-center gap-2 p-2 overflow-x-auto">
            <FilterIcon className="h-4 w-4 text-slate-400 shrink-0" />

            {showSelects && selects.map((s) => (
              <select
                key={s.key}
                aria-label={s.ariaLabel}
                value={s.value}
                onChange={(e) => s.onChange(e.target.value)}
                className="h-9 text-sm border border-slate-300 rounded-md px-2 bg-white shrink-0 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
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
              <div className="relative flex-1 min-w-[140px]">
                <Search className="h-4 w-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5 pointer-events-none" />
                <input
                  type="search"
                  placeholder={searchPlaceholder}
                  value={searchValue || ''}
                  onChange={(e) => onSearchChange?.(e.target.value)}
                  className="h-9 w-full ps-8 pe-2 text-sm rounded-md border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                />
              </div>
            )}

            {showSort && (
              // Sort key dropdown + direction toggle, side by side.
              // Both are h-9 so visually they're the same row size.
              <>
                <select
                  aria-label="מיון לפי"
                  value={sortKey}
                  onChange={(e) => onSortKeyChange?.(e.target.value as S)}
                  className="h-9 text-sm border border-slate-300 rounded-md px-2 bg-white shrink-0 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
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
                  className="h-9 w-9 inline-flex items-center justify-center rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-600 shrink-0"
                >
                  {sortDir === 'asc'
                    ? <ArrowUp className="h-4 w-4" />
                    : <ArrowDown className="h-4 w-4" />}
                </button>
              </>
            )}

            {hasActiveFilter && onClear && (
              <button
                type="button"
                onClick={onClear}
                className="h-9 inline-flex items-center gap-1 px-3 text-sm font-medium rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 shrink-0"
              >
                <X className="h-3.5 w-3.5" />
                נקה
              </button>
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
