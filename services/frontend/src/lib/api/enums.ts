import { apiFetch } from './client';
import type { Profession } from '@/types';

// R30 §26 · the three enum catalogs are immutable reference data, and
// they were being fetched once per CALLER. On the home page that meant
// six requests for three catalogs: EnumsProvider (app/layout.tsx) asked
// for all three, and app/page.tsx asked for all three again directly,
// bypassing the context it was already inside.
//
// Six of an anonymous visitor's thirty-per-minute gateway budget
// (services/gateway/src/rateLimit.js), spent re-fetching data that
// cannot change within a page view. Since the sponsor rail's fetch is
// issued last, that waste is what pushed it past the ceiling and got
// it 429'd — the paid ad slot paid for the duplication.
//
// The cache lives HERE rather than in EnumsContext on purpose: a
// context-level cache only helps callers that use the context, and
// five of the current call sites don't. Memoising the PROMISE (not the
// value) also means concurrent first-render callers await the same
// in-flight request instead of racing.
//
// Lifetime is the module, i.e. the page view — a full navigation
// reloads it. A rejected catalog is evicted so a retry is a real
// network attempt rather than a replay of the same failure.
type EnumKey = 'professions' | 'regions' | 'origins';

const _cache = new Map<EnumKey, Promise<unknown>>();

function cached<T>(key: EnumKey, fetcher: () => Promise<T>): Promise<T> {
  const hit = _cache.get(key);
  if (hit) return hit as Promise<T>;
  const p = fetcher();
  _cache.set(key, p);
  void p.catch(() => { _cache.delete(key); });
  return p;
}

/** Drop the memoised catalogs so the next call hits the network.
 *  Used by the EnumsContext retry path — without this, a user who
 *  landed on the error branch would replay the rejected promise and
 *  the retry button would look dead. */
export function clearEnumCache(): void {
  _cache.clear();
}

export type RegionOrOriginRow = { code: string; name_he: string; name_en: string };

export const enumApi = {
  professions: () =>
    cached('professions', () => apiFetch<Profession[]>('/enums/professions')),
  regions: () =>
    cached('regions', () => apiFetch<RegionOrOriginRow[]>('/enums/regions')),
  origins: () =>
    cached('origins', () => apiFetch<RegionOrOriginRow[]>('/enums/origins')),
};
