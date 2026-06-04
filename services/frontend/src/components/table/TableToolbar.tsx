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

import { ArrowUp, ArrowDown, Filter as FilterIcon, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
        <Card>
          <CardContent className="p-3 flex flex-wrap items-center gap-3">
            <FilterIcon className="h-4 w-4 text-slate-400 shrink-0" />

            {showSelects && selects.map((s) => (
              <select
                key={s.key}
                aria-label={s.ariaLabel}
                value={s.value}
                onChange={(e) => s.onChange(e.target.value)}
                className="text-sm border border-slate-300 rounded-md px-2 py-1.5 bg-white"
              >
                {s.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ))}

            {showSearch && (
              <Input
                placeholder={searchPlaceholder}
                value={searchValue || ''}
                onChange={(e) => onSearchChange?.(e.target.value)}
                className="flex-1 min-w-[200px]"
              />
            )}

            {showSort && (
              <div className="inline-flex items-center gap-1">
                <span className="text-xs text-slate-500">מיון:</span>
                <select
                  aria-label="מיון"
                  value={sortKey}
                  onChange={(e) => onSortKeyChange?.(e.target.value as S)}
                  className="text-sm border border-slate-300 rounded-md px-2 py-1.5 bg-white"
                >
                  {sortOptions.map((o) => (
                    <option key={o.key} value={o.key}>{o.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={onSortDirToggle}
                  aria-label={sortDir === 'asc' ? 'סדר עולה' : 'סדר יורד'}
                  className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-600"
                >
                  {sortDir === 'asc'
                    ? <ArrowUp className="h-4 w-4" />
                    : <ArrowDown className="h-4 w-4" />}
                </button>
              </div>
            )}

            {hasActiveFilter && onClear && (
              <Button
                variant="outline"
                size="sm"
                onClick={onClear}
                className="inline-flex items-center gap-1"
              >
                <X className="h-3.5 w-3.5" />
                נקה סינון
              </Button>
            )}
          </CardContent>
        </Card>
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
