// R6 §1a · IntersectionObserver-based ad impression hook.
//
// Contract:
//   const ref = useAdImpression({ targetId, placement, category });
//   return <div ref={ref}>...ad content...</div>;
//
// Rules (all §1a guardrails):
//   1. ≥50% of the ad's bounding box must be visible for ≥1 second
//      continuously before an impression counts. A fast scroll past
//      is NOT an impression — Yulian: "ספירה בשרת = חיוב על אוויר".
//   2. Exactly ONE impression per (targetId, page load). Scrolling
//      the ad in and out of view does not re-fire.
//   3. IntersectionObserver missing (very old browser, some server-
//      side render passes) → no error, no fallback. Missing
//      analytics is safer than a broken page.
//   4. targetId changes → treated as a new ad; the old timer clears
//      and a fresh observer registers.
//   5. Cleanup on unmount cancels the pending 1-second timer.

import { useEffect, useRef, useCallback } from 'react';
import { postAdEvent, type AdPlacement } from '@/lib/adEvents';

interface Options {
  targetId?:  string;
  placement?: AdPlacement;
  category?:  string;
}

// Module-level guard so re-mounts of the same ad on the same page
// (e.g. a carousel rotation that unmounts + re-renders the current
// slide) don't double-count. Cleared on tab close because it lives
// only in JS memory.
const firedIds = new Set<string>();

export function useAdImpression({ targetId, placement, category }: Options) {
  // Element (not HTMLDivElement) so callers can attach to any DOM
  // element: <li>, <a>, <section>, etc. IntersectionObserver only
  // needs a bounding-rect target.
  const nodeRef = useRef<Element | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const timerRef = useRef<number | null>(null);

  // Callback ref so consumers can pass a ref-forwarded div without
  // needing useRef themselves. React calls this with the DOM node on
  // mount and `null` on unmount.
  const setRef = useCallback((node: Element | null) => {
    nodeRef.current = node;
    // Fresh observer for a new node. Previous observer is
    // disconnected inside the useEffect cleanup — this ref-swap
    // itself is intentionally cheap.
  }, []);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node || !targetId) return;
    if (firedIds.has(targetId)) return; // already counted this page load
    if (typeof IntersectionObserver === 'undefined') return;

    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            // Start the 1-second continuous-visibility timer. If
            // another entry fires (rescroll) before the timer
            // completes, we just extend — 1s of ANY continuous
            // ≥50% window counts.
            if (timerRef.current === null) {
              timerRef.current = window.setTimeout(() => {
                if (!firedIds.has(targetId)) {
                  firedIds.add(targetId);
                  postAdEvent({
                    event_type:  'impression',
                    target_type: 'sponsor_ad',
                    target_id:   targetId,
                    placement,
                    category,
                  });
                }
                clearTimer();
                observer.disconnect();
                observerRef.current = null;
              }, 1000);
            }
          } else {
            // Fell below the 50%/1s bar before firing → reset.
            // The next scroll-back-in restarts the 1s window.
            clearTimer();
          }
        }
      },
      { threshold: [0.5] }
    );
    observer.observe(node);
    observerRef.current = observer;

    return () => {
      clearTimer();
      observer.disconnect();
      observerRef.current = null;
    };
  }, [targetId, placement, category]);

  return setRef;
}
