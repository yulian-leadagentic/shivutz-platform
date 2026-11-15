import { apiFetch } from './client';
import type { PaymentMethod } from '@/types';

// ─── Pivot/v2 — subscription endpoints ──────────────────────────────────────

export type SubscriptionTier   = 'basic' | 'advanced' | 'pro';
// R9 §5 · `comped` is the admin-granted freebie status. Never billed,
// never expires; treated as entitled at every gate.
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired' | 'comped';

export interface SubscriptionRow {
  id: string;
  entity_id: string;
  entity_type: 'contractor' | 'corporation' | 'service_provider';
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  cardcom_plan_code: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export const subscriptionApi = {
  me: () =>
    apiFetch<SubscriptionRow>('/payments/subscriptions/me'),

  start: (tier: SubscriptionTier) =>
    apiFetch<{
      mode:               string;   // 'fake' | 'real'
      tier?:              SubscriptionTier;
      status?:            SubscriptionStatus;
      current_period_end?: string | null;
      // L5 §8 — Cardcom returns these on a successful real charge.
      // Absent in fake mode; the billing page shows the link when
      // present and hides the row otherwise.
      invoice_number?:    string | null;
      invoice_url?:       string | null;
    }>(
      '/payments/subscriptions/start',
      { method: 'POST', body: JSON.stringify({ tier }) },
    ),

  cancel: () =>
    apiFetch<{ status: 'cancelled' }>(
      '/payments/subscriptions/cancel',
      { method: 'POST' },
    ),

  /** R4 · buy N extra seats mid-cycle. The server dedups on
   *  idempotency_key so a double-click cannot double-charge; the
   *  response's `duplicate: true` flag says a replay was detected. */
  purchaseSeats: (count: number, idempotencyKey: string) =>
    apiFetch<{
      mode:              string;     // 'fake' | 'real'
      kind:              'seat_purchase';
      count:             number;
      amount_nis:        number;
      extra_seats_paid:  number;
      duplicate:         boolean;
      invoice_number?:   string | null;
      invoice_url?:      string | null;
      event_id?:         string;
    }>(
      '/payments/subscriptions/seats/purchase',
      { method: 'POST', body: JSON.stringify({ count, idempotency_key: idempotencyKey }) },
    ),
};

/** R37 4.1.2 · one charge for a marketplace plan. */
export interface MarketplaceCharge {
  id: string;
  kind: 'purchase' | 'renewal';
  status: 'charged' | 'refunded' | 'declined';
  category_code: string;
  category_name_he: string | null;
  amount_nis: number;
  invoice_number: string | null;
  invoice_url: string | null;
  /** 'fake' when the payment service ran in test mode: no money moved. */
  mode: 'fake' | 'real';
  created_at: string | null;
  refunded_at: string | null;
}

export const marketplaceChargesApi = {
  /** The caller's own plan charges, newest first. */
  mine: () => apiFetch<MarketplaceCharge[]>('/payments/marketplace/charges/mine'),
};

/** R37 4.1.5 · a plan charge as a platform admin sees it. */
export interface AdminMarketplaceCharge {
  id: string;
  kind: 'purchase' | 'renewal';
  /** 'charging' / 'refunding' that stay are charges or refunds whose
   *  outcome is not known; 'error' is a charge Cardcom never answered. */
  status: 'charged' | 'refunded' | 'declined' | 'error' | 'charging' | 'refunding';
  entity_type: string;
  entity_id: string;
  advertiser_name: string | null;
  subscription_id: string | null;
  category_code: string;
  category_name_he: string | null;
  amount_nis: number;
  invoice_number: string | null;
  invoice_url: string | null;
  failure_reason: string | null;
  mode: 'fake' | 'real';
  created_at: string | null;
  refunded_at: string | null;
  refunded_by_user_id: string | null;
}

export const marketplaceChargesAdminApi = {
  /** Every plan charge, newest first. Admin only. */
  list: () => apiFetch<AdminMarketplaceCharge[]>('/payments/marketplace/charges'),

  /** Return a charge to the card it was made on, in full. The plan is
   *  not changed. Admin only; a charge is refunded once. */
  refund: (chargeId: string) =>
    apiFetch<AdminMarketplaceCharge>(
      `/payments/marketplace/charges/${encodeURIComponent(chargeId)}/refund`,
      { method: 'POST' },
    ),
};

export interface CardSetupResult {
  /** completed: the card is saved. pending: Cardcom has no final answer
   *  yet. failed: Cardcom reported a failure, nothing was saved. */
  status: 'completed' | 'pending' | 'failed';
  payment_method: PaymentMethod | null;
  reason?: string | null;
  mode: 'fake' | 'real';
}

export const paymentApi = {
  /** List payment methods for the authenticated entity (from JWT context). */
  methods: () =>
    apiFetch<PaymentMethod[]>('/payments/payment-methods'),

  /** R37 4.1.1 · add or replace the caller's card. Answers the address
   *  of the page where the card is typed (Cardcom's); send the browser
   *  there. Cardcom sends it back with ?card_setup=<setup_id>. */
  setupCard: () =>
    apiFetch<{ setup_id: string; url: string; mode: 'fake' | 'real' }>(
      '/payments/payment-methods/setup',
      { method: 'POST' },
    ),

  /** Back from the card page: was the card saved? The server asks
   *  Cardcom. Safe to call again. */
  confirmCardSetup: (setupId: string) =>
    apiFetch<CardSetupResult>(
      `/payments/payment-methods/setup/${encodeURIComponent(setupId)}/confirm`,
      { method: 'POST' },
    ),

  /** Delete (soft) a payment method. */
  deleteMethod: (pmId: string) =>
    apiFetch<void>(`/payments/payment-methods/${pmId}`, { method: 'DELETE' }),

  /** Set a payment method as the default. */
  setDefault: (pmId: string) =>
    apiFetch<{ id: string; is_default: boolean }>(
      `/payments/payment-methods/${pmId}/set-default`,
      { method: 'PATCH' }
    ),
};
