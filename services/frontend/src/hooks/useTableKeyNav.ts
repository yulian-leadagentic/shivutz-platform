'use client';

import { useEffect } from 'react';

/**
 * Vim-style row navigation for admin tables.
 *
 *   j / ↓  → next row
 *   k / ↑  → previous row
 *   Enter  → click the focused row's primary action (or the row itself)
 *
 * Rows opt in by rendering a `data-table-row="true"` attribute and a
 * `tabIndex={-1}` so they can receive programmatic focus without
 * sitting in the Tab order. Click semantics use the focused row's
 * `[data-table-row-action]` element when present, otherwise the row.
 *
 * The hook is a no-op when:
 *   - the user is typing in input / textarea / contentEditable
 *   - a modifier (cmd/ctrl/alt) is held — leaves OS shortcuts intact
 *   - `enabled` is false (e.g. while a modal is open)
 *
 * Skips elements with `data-table-row-disabled="true"` so loading
 * skeletons or hidden rows don't trap focus.
 */
export function useTableKeyNav(opts: { enabled?: boolean } = {}) {
  const enabled = opts.enabled !== false;

  useEffect(() => {
    if (!enabled) return;

    function isTextInput(t: EventTarget | null): boolean {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (t.isContentEditable) return true;
      return false;
    }

    function rows(): HTMLElement[] {
      return Array.from(
        document.querySelectorAll<HTMLElement>(
          'tr[data-table-row="true"]:not([data-table-row-disabled="true"]), [data-table-row="true"]:not(tr):not([data-table-row-disabled="true"])',
        ),
      );
    }

    function focusedIndex(list: HTMLElement[]): number {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return -1;
      // Either the row itself is focused, or a descendant of one
      return list.findIndex((r) => r === active || r.contains(active));
    }

    function focusRow(el: HTMLElement) {
      el.focus({ preventScroll: false });
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTextInput(e.target)) return;

      const key = e.key;
      const isNext = key === 'j' || key === 'ArrowDown';
      const isPrev = key === 'k' || key === 'ArrowUp';
      const isEnter = key === 'Enter';
      if (!isNext && !isPrev && !isEnter) return;

      const list = rows();
      if (list.length === 0) return;

      if (isEnter) {
        const idx = focusedIndex(list);
        if (idx < 0) return;
        e.preventDefault();
        const row = list[idx];
        const action = row.querySelector<HTMLElement>('[data-table-row-action]');
        (action ?? row).click();
        return;
      }

      e.preventDefault();
      const idx = focusedIndex(list);
      let next: number;
      if (idx < 0) next = isNext ? 0 : list.length - 1;
      else if (isNext) next = Math.min(idx + 1, list.length - 1);
      else next = Math.max(idx - 1, 0);
      focusRow(list[next]);
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
