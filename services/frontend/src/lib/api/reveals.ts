// L7 — reveal history API.
//
// Two views on the same contact_reveals table, each strictly scoped
// by role in the backend WHERE clause:
//   corpApi.list()        → GET /ads/mine/reveals   (PRD-1)
//   contractorApi.list()  → GET /contractor/reveals (PRD-2)
// The corp response NEVER contains contractor identity fields — the
// backend does not select them. Do not add "guess-what-contractor"
// UI on the corp side; there is nothing to guess with.

import { apiFetch } from './client';

export interface CorpReveal {
  id:              string;
  ad_id:           string;
  revealed_at:     string;
  title_he:        string;
  ad_type:         'worker' | 'housing';
  profession_code: string | null;
  // region is intentionally NOT here — see reveals.py:REGION_MIN_REVEALS
  // for the k-anonymity reasoning. Ships in a follow-up when data
  // volume clears the floor.
}

export interface ContractorReveal {
  id:              string;
  ad_id:           string;
  revealed_at:     string;
  title_he:        string;
  ad_type:         'worker' | 'housing';
  profession_code: string | null;
  origin_country:  string | null;
  region:          string | null;
  ad_removed:      boolean;
  company_name:    string;
  phone:           string | null;
  email:           string | null;
}

export interface RevealsPage<T> {
  results:     T[];
  next_cursor: string | null;
}

export interface RevealFilters {
  from?:  string;
  to?:    string;
  ad_id?: string;
  q?:     string;
  limit?: number;
  cursor?: string;
}

function qs(f: RevealFilters): string {
  const p = new URLSearchParams();
  if (f.from)   p.set('from',   f.from);
  if (f.to)     p.set('to',     f.to);
  if (f.ad_id)  p.set('ad_id',  f.ad_id);
  if (f.q)      p.set('q',      f.q);
  if (f.limit)  p.set('limit',  String(f.limit));
  if (f.cursor) p.set('cursor', f.cursor);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const revealsApi = {
  corp:  (f: RevealFilters = {}) =>
    apiFetch<RevealsPage<CorpReveal>>(`/ads/mine/reveals${qs(f)}`),
  contractor: (f: RevealFilters = {}) =>
    apiFetch<RevealsPage<ContractorReveal>>(`/contractor/reveals${qs(f)}`),
};

/** Absolute URL to the CSV endpoint, for a plain <a href> download.
 *  We hand the browser a direct download rather than fetching+blob
 *  because Excel-in-Hebrew UX is finicky and the streaming server
 *  response is already UTF-8+BOM. */
export function corpRevealsCsvUrl(f: RevealFilters, apiOrigin: string): string {
  return `${apiOrigin}/ads/mine/reveals.csv${qs(f)}`;
}

export function contractorRevealsCsvUrl(f: RevealFilters, apiOrigin: string): string {
  return `${apiOrigin}/contractor/reveals.csv${qs(f)}`;
}
