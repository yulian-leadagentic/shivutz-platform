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

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(false);
    const [r, p, o] = await Promise.allSettled([
      enumApi.regions(),
      enumApi.professions(),
      enumApi.origins(),
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

  const retry = useCallback(() => { void fetchAll(); }, [fetchAll]);

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
