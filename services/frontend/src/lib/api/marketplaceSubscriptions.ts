// Subscriber-facing API for buying / managing marketplace subscriptions.
// Backed by services/user-org/app/routes/marketplace_subscriptions.py.
import { apiFetch } from './client';

export interface SubscriptionTierBrief {
  tier_id:          string;
  name_he:          string;
  name_en:          string;
  slot_count:       number;
  duration_days:    number;
  price_nis:        number;
  category_code:    string;
  category_name_he: string;
}

export interface Subscription {
  id:                       string;
  advertiser_entity_type:   'contractor' | 'corporation';
  advertiser_entity_id:     string;
  category_code:            string;
  category_name_he?:        string;
  category_name_en?:        string;
  tier_id:                  string;
  slot_count:               number;
  duration_days:            number;
  price_nis:                number;
  expires_at:               string;
  auto_renew:               boolean;
  status:                   'active' | 'expired' | 'cancelled';
  cardcom_token_ref?:       string | null;
  payment_transaction_id?:  string | null;
  cancelled_at?:            string | null;
  created_at:               string;
  updated_at:               string;
  // Annotated by /my/subscriptions only:
  slots_used?:              number;
  slots_available?:         number;
}

export interface SubscriptionQuote {
  tier:     SubscriptionTierBrief;
  existing_subscription: Subscription | null;
  advertiser: { entity_type: 'contractor' | 'corporation'; entity_id: string };
}

// Public — used by the subscribe page to list available bundles.
export interface CatalogTier {
  id:            string;
  category_code: string;
  name_he:       string;
  name_en:       string;
  slot_count:    number;
  duration_days: number;
  price_nis:     number;
  sort_order:    number;
}

export interface CatalogCategory {
  code:        string;
  name_he:     string;
  name_en:     string;
  name_ar?:    string | null;
  icon_slug?:  string | null;
  sort_order:  number;
  tiers:       CatalogTier[];
}

export const marketplaceSubscriptionsApi = {
  /** Public list of categories + active tiers — drives the subscribe page. */
  catalog: () =>
    apiFetch<CatalogCategory[]>('/marketplace/admin/catalog'),

  /** Quote a tier (preview before commit). */
  quote: (tier_id: string) =>
    apiFetch<SubscriptionQuote>('/marketplace/subscriptions/quote', {
      method: 'POST',
      body: JSON.stringify({ tier_id }),
    }),

  /** Purchase + activate. FAKE-payment until Cardcom is configured. */
  purchase: (tier_id: string, auto_renew: boolean) =>
    apiFetch<Subscription>('/marketplace/subscriptions', {
      method: 'POST',
      body: JSON.stringify({ tier_id, auto_renew }),
    }),

  /** Caller's subscriptions (active + expired + cancelled), with slot usage. */
  mine: () => apiFetch<Subscription[]>('/marketplace/my/subscriptions'),

  /** Cancel auto-renew on an active subscription. */
  cancelAutoRenew: (id: string) =>
    apiFetch<void>(`/marketplace/my/subscriptions/${id}/auto-renew`, {
      method: 'DELETE',
    }),
};
