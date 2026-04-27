'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
}

const EMPTY: EnumsContextValue = {
  regions: [],
  professions: [],
  origins: [],
  regionMap: {},
  professionMap: {},
  originMap: {},
  loading: true,
};

const EnumsContext = createContext<EnumsContextValue>(EMPTY);

/**
 * Fetches reference enums (regions, professions, origins) once per session
 * and exposes them — plus code→name_he lookup maps — to all descendants.
 */
export function EnumsProvider({ children }: { children: ReactNode }) {
  const [regions, setRegions] = useState<RegionOrOrigin[]>([]);
  const [professions, setProfessions] = useState<Profession[]>([]);
  const [origins, setOrigins] = useState<RegionOrOrigin[]>([]);
  const [loading, setLoading] = useState(true);
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    Promise.allSettled([
      enumApi.regions(),
      enumApi.professions(),
      enumApi.origins(),
    ]).then(([r, p, o]) => {
      if (r.status === 'fulfilled') setRegions(r.value);
      if (p.status === 'fulfilled') setProfessions(p.value);
      if (o.status === 'fulfilled') setOrigins(o.value);
      setLoading(false);
    });
  }, []);

  const value = useMemo<EnumsContextValue>(() => {
    const regionMap: Record<string, string> = {};
    regions.forEach((r) => { regionMap[r.code] = r.name_he; });
    const professionMap: Record<string, string> = {};
    professions.forEach((p) => { professionMap[p.code] = p.name_he; });
    const originMap: Record<string, string> = {};
    origins.forEach((o) => { originMap[o.code] = o.name_he; });
    return { regions, professions, origins, regionMap, professionMap, originMap, loading };
  }, [regions, professions, origins, loading]);

  return <EnumsContext.Provider value={value}>{children}</EnumsContext.Provider>;
}

export function useEnums(): EnumsContextValue {
  return useContext(EnumsContext);
}
