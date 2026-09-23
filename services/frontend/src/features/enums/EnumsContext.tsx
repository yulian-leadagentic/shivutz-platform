'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { enumApi } from '@/lib/api';
import type { Profession } from '@/types';

export interface RegionOrOrigin {
  code: string;
  name_he: string;
  name_en: string;
}

export interface EnumsContextValue {
  regions: RegionOrOrigin[];
  professions: Profession[];
  origins: RegionOrOrigin[];
  regionMap: Record<string, string>;
  professionMap: Record<string, string>;
  originMap: Record<string, string>;
  loading: boolean;
  /** U5 §2 — populated when any of the three fetches rejects after the
   *  final settlement. Consumers use it to render a "לא הצלחנו לטעון" +
   *  "נסה שוב" branch instead of an eternal spinner. */
  error: boolean;
  /** U5 §2 — re-runs all three fetches. Safe to call from a retry
   *  button; the internal `fired` guard is bypassed on manual retry. */
  retry: () => void;
}

const EMPTY: EnumsContextValue = {
  regions: [],
  professions: [],
  origins: [],
  regionMap: {},
  professionMap: {},
  originMap: {},
  loading: true,
  error: false,
  retry: () => {},
};

const EnumsContext = createContext<EnumsContextValue>(EMPTY);

// R30 §26 · module-scoped promise cache for the three enum catalogs.
// These are reference data — they don't change within a page view —
// so the first caller's in-flight request is what every later caller
// awaits. Lives outside the component on purpose: a provider remount
// must NOT restart the requests, which is exactly the leak the
// `fired` ref could not close.
const _enumCache = new Map<string, Promise<unknown>>();

function cachedEnum<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const hit = _enumCache.get(key);
  if (hit) return hit as Promise<T>;
  const p = fetcher();
  _enumCache.set(key, p);
  // A rejected catalog must not be cached forever — drop it so the
  // retry path (and any later mount) can try the network again.
  void p.catch(() => { _enumCache.delete(key); });
  return p;
}

function clearEnumCache(): void {
  _enumCache.clear();
}

/**
 * Fetches reference enums (regions, professions, origins) once per session
 * and exposes them — plus code→name_he lookup maps — to all descendants.
 *
 * U5 §2 · used to swallow rejected fetches silently, so a consumer that
 * only checked `regions.length === 0` (e.g. the contractor registration
 * form) showed "טוען אזורים…" forever on any failure. The provider now
 * tracks an `error` flag and exposes `retry()` so consumers can offer
 * a real recovery path.
 */
export function EnumsProvider({ children }: { children: ReactNode }) {
  const [regions, setRegions] = useState<RegionOrOrigin[]>([]);
  const [professions, setProfessions] = useState<Profession[]>([]);
  const [origins, setOrigins] = useState<RegionOrOrigin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const fired = useRef(false);

  const fetchAll = useCallback(async (force = false) => {
    setLoading(true);
    setError(false);
    // R30 §26 · the `fired` ref below guards a double-invoked effect
    // but NOT a remount — StrictMode tears the provider down and
    // builds a fresh one, ref included, so all three enum requests
    // went out twice. Six of an anonymous visitor's thirty-per-minute
    // gateway budget, spent re-fetching a catalog that had not
    // changed. Caching the promises at module scope makes the second
    // mount reuse the first mount's in-flight requests.
    // `force` is the retry path: it clears the cache so a user who
    // hit the error branch gets a genuine re-fetch, not the rejected
    // promise again.
    if (force) clearEnumCache();
    const [r, p, o] = await Promise.allSettled([
      cachedEnum('regions',     enumApi.regions),
      cachedEnum('professions', enumApi.professions),
      cachedEnum('origins',     enumApi.origins),
    ]);
    if (r.status === 'fulfilled') setRegions(r.value);
    if (p.status === 'fulfilled') setProfessions(p.value);
    if (o.status === 'fulfilled') setOrigins(o.value);
    // Any reject is a real problem — show the error branch even if one
    // or two of the three arrays came back. The consumer that needs
    // regions specifically will see "טוען…" resolve to an error rather
    // than to an empty select.
    const anyFailed = [r, p, o].some((s) => s.status === 'rejected');
    setError(anyFailed);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    void fetchAll();
  }, [fetchAll]);

  // Retry bypasses the module cache — otherwise it would replay the
  // same rejected promise and the button would appear dead.
  const retry = useCallback(() => { void fetchAll(true); }, [fetchAll]);

  const value = useMemo<EnumsContextValue>(() => {
    const regionMap: Record<string, string> = {};
    regions.forEach((r) => { regionMap[r.code] = r.name_he; });
    const professionMap: Record<string, string> = {};
    professions.forEach((p) => { professionMap[p.code] = p.name_he; });
    const originMap: Record<string, string> = {};
    origins.forEach((o) => { originMap[o.code] = o.name_he; });
    return { regions, professions, origins, regionMap, professionMap, originMap, loading, error, retry };
  }, [regions, professions, origins, loading, error, retry]);

  return <EnumsContext.Provider value={value}>{children}</EnumsContext.Provider>;
}

export function useEnums(): EnumsContextValue {
  return useContext(EnumsContext);
}
