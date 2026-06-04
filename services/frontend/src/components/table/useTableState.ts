'use client';

/**
 * useTableState — shared filter+sort plumbing for table pages.
 *
 * Each consumer table calls it with:
 *   - the source rows
 *   - an initial sortKey + sortDir
 *   - a `filter` predicate that closes over the page's filter/search state
 *   - a `sortBy` function that maps a row + sortKey to a comparable value
 *
 * The hook tracks sortKey/sortDir internally and returns:
 *   - filtered+sorted rows
 *   - the current sort state + a setter + a toggle for the direction
 *
 * Filter state itself lives in each consumer (because the SHAPE of
 * filter state varies per table — pills, dropdowns, text). The hook
 * is just the glue that runs filter then sort and memoises the result.
 */

import { useMemo, useState, useCallback } from 'react';

type Comparable = string | number | Date | null | undefined;

export interface UseTableStateConfig<T, S extends string> {
  rows: T[];
  initialSortKey: S;
  initialSortDir?: 'asc' | 'desc';
  /** Return true to keep the row, false to filter it out. */
  filter?: (row: T) => boolean;
  /** Return the comparable value for the row under the given sort key. */
  sortBy: (row: T, key: S) => Comparable;
}

export function useTableState<T, S extends string>(config: UseTableStateConfig<T, S>) {
  const {
    rows, initialSortKey, initialSortDir = 'desc',
    filter, sortBy,
  } = config;

  const [sortKey, setSortKey] = useState<S>(initialSortKey);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initialSortDir);

  /** Set a new sort key. If it's the same key, flip direction instead —
   *  matches the common spreadsheet behaviour where clicking the
   *  active column header toggles asc/desc. */
  const toggleSort = useCallback((next: S) => {
    setSortKey((prev) => {
      if (prev === next) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      // New column — reset to descending (most relevant for date/recency
      // columns; pages with name-as-default-sort can override via setSortDir).
      setSortDir('desc');
      return next;
    });
  }, []);

  const visible = useMemo(() => {
    let out = filter ? rows.filter(filter) : rows.slice();
    const dir = sortDir === 'asc' ? 1 : -1;
    out = [...out].sort((a, b) => {
      const va = sortBy(a, sortKey);
      const vb = sortBy(b, sortKey);
      if (va === vb) return 0;
      // Null/undefined ALWAYS sort to the end regardless of direction —
      // typical user expectation ("blanks at the bottom").
      if (va == null) return 1;
      if (vb == null) return -1;
      if (va instanceof Date && vb instanceof Date) {
        return (va.getTime() - vb.getTime()) * dir;
      }
      if (typeof va === 'number' && typeof vb === 'number') {
        return (va - vb) * dir;
      }
      return String(va).localeCompare(String(vb), 'he') * dir;
    });
    return out;
  }, [rows, filter, sortBy, sortKey, sortDir]);

  return {
    visible,
    sortKey,
    sortDir,
    setSortKey,
    setSortDir,
    toggleSort,
    /** Flip direction without changing the key. Bound to the toolbar's
     *  direction button. */
    flipSortDir: useCallback(() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')), []),
  };
}
