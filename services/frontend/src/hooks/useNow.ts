'use client';

// useNow — re-render the calling component every `intervalMs`
// (default 1s) so absolute "deadline minus now" countdowns can
// render the next second without manual setInterval bookkeeping
// at every call site.
//
// Cheap: a single setInterval per component instance. The hook
// returns a number (ms since epoch) rather than a Date object so
// equality comparisons (and React's bail-out) work as expected.
//
// SSR safety: returns 0 during server render AND on the first
// client render — Date.now() would otherwise produce different
// values on the two passes and break hydration with the React
// "tree hydrated but attributes didn't match" warning. After
// useEffect fires (client only, post-mount) the hook switches
// to real Date.now() ticks. Consumers should treat now=0 as
// "not yet mounted" and render a placeholder accordingly.

import { useEffect, useState } from 'react';

export function useNow(intervalMs: number = 1000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
