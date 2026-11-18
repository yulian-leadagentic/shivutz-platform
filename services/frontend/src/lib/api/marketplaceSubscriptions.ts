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
  advertiser_entity_type:   'contractor' | 'corporation' | 'service_provider';
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
  /** 'past_due': a paid plan whose renewal charge failed. The charge is
   *  tried again at next_attempt_at; after repeated failures the plan
   *  ends and its listings are paused (R37 4.1.4). */
  status:                   'active' | 'past_due' | 'expired' | 'cancelled';
  next_attempt_at?:         string | null;
  rebill_attempts?:         number;
  /** Why nothing was paid, when nothing was: 'launch_free_promo', 'r33_backfill'. */
  promo_note?:              string | null;
  cardcom_token_ref?:       string | null;
  payment_transaction_id?:  string | null;
  cancelled_at?:            string | null;
  created_at:               string;
  updated_at:               string;
  // Annotated by /my/subscriptions only:
  slots_used?:              number;
  slots_available?:         number;
  tier_name_he?:            string | null;
  /** Running right now: status 'active' and not past expires_at.
   *  `status` alone is not enough, nothing flips it when a plan lapses. */
  is_current?:              boolean;
}

export interface SubscriptionQuote {
  tier:     SubscriptionTierBrief;
  existing_subscription: Subscription | null;
  advertiser: { entity_type: 'contractor' | 'corporation' | 'service_provider'; entity_id: string };
  /** R33 B.3 · providers only: YYYY-MM-DD when the launch promo is on,
   *  meaning this purchase charges nothing and runs until that date.
   *  null when a purchase would have to be paid for. */
  promo_end?: string | null;
  /** Fixes ג item 6 · the tier price before VAT, the VAT and the total a
   *  purchase charges. null when no VAT rate is in force. */
  vat?: { net_nis: number; vat_percent: number; vat_nis: number; total_nis: number } | null;
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

// R34 4c · what a category asks of a listing. Data, kept on the
// category row and validated by the server
// (services/user-org/app/services/listing_attributes.py).
export interface CategoryField {
  key:       string;
  label:     string;
  type:      'text' | 'int' | 'money' | 'bool' | 'select' | 'multi' | 'date';
  options?:  string[];
  required?: boolean;
  /** Shown only while that other (bool) field is ticked. */
  show_if?:  string;
}

export interface CategoryFieldSchema {
  fields:       CategoryField[];
  require_any?: string[][];
  price?: {
    amount?:   string;
    unit?:     string;
    first_of?: [string, string][];
    /** The category quotes instead of pricing; shown as is. */
    note?:     string;
  };
}

export interface CatalogCategory {
  code:        string;
  name_he:     string;
  name_en:     string;
  name_ar?:    string | null;
  icon_slug?:  string | null;
  sort_order:  number;
  tiers:       CatalogTier[];
  field_schema?: CategoryFieldSchema | null;
}

export const marketplaceSubscriptionsApi = {
  /** Public list of categories + active tiers — drives the subscribe page. */
  catalog: () =>
    apiFetch<CatalogCategory[]>('/marketplace/subscriptions/catalog'),

  /** Quote a tier (preview before commit). */
  quote: (tier_id: string) =>
    apiFetch<SubscriptionQuote>('/marketplace/subscriptions/quote', {
      method: 'POST',
      body: JSON.stringify({ tier_id }),
    }),

  /** Buy a plan. A provider during the launch promo pays nothing. After
   *  it the card on file is charged the tier's price, and the plan
   *  comes back only if the charge succeeded; the answer then carries
   *  what was charged and the invoice. A 402 means no card on file
   *  (details.code 'no_payment_method', details.add_card_url) or a
   *  declined card ('card_declined'). */
  purchase: (tier_id: string, auto_renew: boolean) =>
    apiFetch<Subscription & {
      charged_nis?: number | null;
      invoice_number?: string | null;
      invoice_url?: string | null;
    }>('/marketplace/subscriptions', {
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

  /** Turn auto-renew back on, on a plan that is still running. */
  enableAutoRenew: (id: string) =>
    apiFetch<void>(`/marketplace/my/subscriptions/${id}/auto-renew`, {
      method: 'POST',
    }),

  /** Move a running plan to a bigger tier of the same category. */
  upgrade: (id: string, tier_id: string) =>
    apiFetch<Subscription>(`/marketplace/my/subscriptions/${id}/upgrade`, {
      method: 'POST',
      body: JSON.stringify({ tier_id }),
    }),

  /** End a running plan now. Its published listings are paused, not deleted. */
  cancel: (id: string) =>
    apiFetch<{ id: string; status: 'cancelled'; listings_paused: number }>(
      `/marketplace/my/subscriptions/${id}/cancel`,
      { method: 'POST' },
    ),
};
