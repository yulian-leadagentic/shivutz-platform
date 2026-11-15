// R34 5c · provider dashboard numbers.
//
// One call: GET /organizations/providers/me/stats?days=30|7. The server
// decides whose numbers these are from the session alone, so there is
// no provider id to pass and none this client could get wrong. The
// response holds counts only, never who viewed
// (services/user-org/app/routes/provider_stats.py).

import { apiFetch } from './client';

export type ProviderStatsDays = 30 | 7;

export interface ProviderStatsCounts {
  /** A listing card was on screen (half of it, for a second). */
  impressions: number;
  /** The listing's detail panel was opened. */
  opens: number;
  /** Distinct viewers who asked for the contact details. */
  reveals: number;
}

export interface ProviderStatsListing extends ProviderStatsCounts {
  id:            string;
  title:         string;
  category:      string;
  /** Hebrew name from marketplace_categories, the code when unknown. */
  category_name: string;
  /** Region code, null when the listing is nationwide. */
  region:        string | null;
  status:        string;
}

export interface ProviderStatsDay extends ProviderStatsCounts {
  /** YYYY-MM-DD, a calendar day as the database sees it. */
  day: string;
}

export interface ProviderStatsScopeCategory {
  code:    string;
  name:    string;
  /** Region codes the searches were limited to, null for nationwide. */
  regions: string[] | null;
}

export interface ProviderStatsResponse {
  days:   ProviderStatsDays;
  since:  string;
  until:  string;
  totals: ProviderStatsCounts & { searches: number };
  /** Every undeleted listing of the provider, newest first. */
  listings: ProviderStatsListing[];
  /** One entry per day of the window, oldest first, zero-filled. */
  series: ProviderStatsDay[];
  /**
   * What `totals.searches` was counted over. `listings` is the normal
   * case; `primary_category` means the provider has no active listing
   * yet and the category it registered under was used instead.
   */
  search_scope: {
    source:     'listings' | 'primary_category' | 'none';
    categories: ProviderStatsScopeCategory[];
  };
}

export const providerStatsApi = {
  get: (days: ProviderStatsDays = 30) =>
    apiFetch<ProviderStatsResponse>(`/organizations/providers/me/stats?days=${days}`),
};
