import { apiFetch } from './client';
import type { AdRow } from './ads';

// Pivot/v2 Phase 3 — search + contact reveal.

export interface SearchFilters {
  ad_type:         'worker' | 'housing';
  profession_code: string | null;
  origin_country:  string | null;
  region:          string | null;
  quantity:        number | null;
  canonical_query: string;
}

// Search results omit contact info — that comes from a separate
// reveal call gated on subscription. Housing fields are populated
// only when ad_type === 'housing'.
export type AdSearchResult = Omit<AdRow,
  | 'owner_entity_type'
  | 'active' | 'view_count' | 'created_at' | 'updated_at' | 'deleted_at'
>;

// NM — the backend's second pass runs when the exact match is thin
// (< 3 rows) AND the rewriter extracted a relax-eligible filter. It
// re-queries with ONE filter dropped and returns those rows as
// `near_matches` alongside the exact `results`. `relaxed` names which
// filter was dropped so the frontend can render an honest Hebrew
// message ("no floorers from China — here are floorers from Romania
// / Ukraine"). Older backends without NM omit both fields; treat as
// empty near set.
export type RelaxedFilter = 'quantity' | 'origin_country' | 'region';

export interface SearchResponse {
  filters:       SearchFilters;
  results:       AdSearchResult[];
  total:         number;
  near_matches?: AdSearchResult[];
  relaxed?:      RelaxedFilter | null;
}

export interface ContactReveal {
  ad_id:        string;
  company_name: string | null;
  phone:        string | null;
  email:        string | null;
}

export const searchApi = {
  query: (q: string) =>
    apiFetch<SearchResponse>('/search', {
      method: 'POST',
      body:   JSON.stringify({ query: q }),
    }),

  revealContact: (adId: string) =>
    apiFetch<ContactReveal>(`/ads/${adId}/contact-reveal`),
};
