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

export interface SearchResponse {
  filters: SearchFilters;
  results: AdSearchResult[];
  total:   number;
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
