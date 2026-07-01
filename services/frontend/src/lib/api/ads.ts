import { apiFetch } from './client';

// Pivot/v2 Phase 2 — ads API client.
// Corp-owner endpoints only. Contractor-side search comes in Phase 3.

export type AdType = 'worker' | 'housing';

export interface AdRow {
  id: string;
  owner_entity_id: string;
  owner_entity_type: 'corporation';
  ad_type: AdType;
  title_he: string;
  body_he: string | null;

  // Worker
  profession_code: string | null;
  origin_country: string | null;
  region: string | null;
  quantity: number | null;
  experience_min_months: number | null;
  visa_valid_until: string | null;
  languages: string[] | null;

  // Housing (Phase 4)
  city: string | null;
  address_he: string | null;
  total_beds: number | null;
  available_beds: number | null;
  price_per_bed_nis: number | null;
  amenities: string[] | null;
  photos: string[] | null;

  // Lifecycle
  active: boolean;
  published_at: string;
  expires_at: string | null;
  featured_until: string | null;
  view_count: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface AdCreateInput {
  ad_type: AdType;
  title_he: string;
  body_he?: string;
  profession_code?: string;
  origin_country?: string;
  region?: string;
  quantity?: number;
  experience_min_months?: number;
  visa_valid_until?: string;
  languages?: string[];
  expires_at?: string;
}

export type AdPatchInput = Partial<AdCreateInput> & { active?: boolean };

export interface UsageResponse {
  tier:     'basic' | 'advanced' | 'pro';
  status:   'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired';
  entitled: boolean;
  limits: {
    reveals_per_month: number | null;
    active_ads:        number | null;
    can_boost:         boolean;
  };
  usage: {
    reveals_this_month: number;
    active_ads:         number;
  };
}

export const adApi = {
  usage:  ()                          => apiFetch<UsageResponse>('/ads/usage'),
  list:   ()                          => apiFetch<AdRow[]>('/ads/mine'),
  get:    (id: string)                => apiFetch<AdRow>(`/ads/${id}`),
  create: (body: AdCreateInput)       => apiFetch<AdRow>('/ads',           { method: 'POST',   body: JSON.stringify(body) }),
  update: (id: string, body: AdPatchInput) => apiFetch<AdRow>(`/ads/${id}`, { method: 'PATCH',  body: JSON.stringify(body) }),
  remove: (id: string)                => apiFetch<void>(`/ads/${id}`,      { method: 'DELETE' }),
  boost:  (id: string)                => apiFetch<{ id: string; featured_until: string }>(`/ads/${id}/boost`, { method: 'POST' }),
};
