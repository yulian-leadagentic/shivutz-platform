// Admin client for the marketplace categories + subscription tiers
// (phase 2.0). Only callers with role=admin will get past the gateway.
import { apiFetch } from './client';

export interface MarketplaceCategory {
  code:       string;
  name_he:    string;
  name_en:    string;
  name_ar?:   string | null;
  icon_slug?: string | null;
  sort_order: number;
  is_active:  boolean;
  created_at: string;
  updated_at: string;
}

export interface MarketplaceTier {
  id:             string;
  category_code:  string;
  name_he:        string;
  name_en:        string;
  slot_count:     number;
  duration_days:  number;
  price_nis:      number;
  sort_order:     number;
  is_active:      boolean;
  created_at:     string;
  updated_at:     string;
}

export interface CategoryInput {
  code:       string;
  name_he:    string;
  name_en:    string;
  name_ar?:   string | null;
  icon_slug?: string | null;
  sort_order: number;
  is_active:  boolean;
}

export interface CategoryPatch {
  name_he?:    string;
  name_en?:    string;
  name_ar?:    string | null;
  icon_slug?:  string | null;
  sort_order?: number;
  is_active?:  boolean;
}

export interface TierInput {
  name_he:       string;
  name_en:       string;
  slot_count:    number;
  duration_days: number;
  price_nis:     number;
  sort_order:    number;
  is_active:     boolean;
}

export interface TierPatch {
  name_he?:       string;
  name_en?:       string;
  slot_count?:    number;
  duration_days?: number;
  price_nis?:     number;
  sort_order?:    number;
  is_active?:     boolean;
}

export const marketplaceAdminApi = {
  listCategories: () =>
    apiFetch<MarketplaceCategory[]>('/marketplace/admin/categories'),

  createCategory: (body: CategoryInput) =>
    apiFetch<{ code: string }>('/marketplace/admin/categories', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateCategory: (code: string, patch: CategoryPatch) =>
    apiFetch<{ code: string; updated: boolean }>(`/marketplace/admin/categories/${code}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  listTiers: (categoryCode: string) =>
    apiFetch<MarketplaceTier[]>(`/marketplace/admin/categories/${categoryCode}/tiers`),

  createTier: (categoryCode: string, body: TierInput) =>
    apiFetch<{ id: string; category_code: string }>(
      `/marketplace/admin/categories/${categoryCode}/tiers`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  updateTier: (id: string, patch: TierPatch) =>
    apiFetch<{ id: string; updated: boolean }>(`/marketplace/admin/tiers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteTier: (id: string) =>
    apiFetch<void>(`/marketplace/admin/tiers/${id}`, { method: 'DELETE' }),
};
