'use client';

// useNow — re-render the calling component every `intervalMs`
// (default 1s) so absolute "deadline minus now" countdowns can
// render the next second without manual setInterval bookkeeping
// at every call site.
//
// Cheap: a single setInterval per component instance. The hook
// returns Date.now() rather than a Date object so equality
// comparisons (and React's bail-out) work as expected.

import { useEffect, useState } from 'react';

export function useNow(intervalMs: number = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
