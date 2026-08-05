import { apiFetch } from './client';
import type { PaymentMethod } from '@/types';

// ─── Pivot/v2 — subscription endpoints ──────────────────────────────────────

export type SubscriptionTier   = 'basic' | 'advanced' | 'pro';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired';

export interface SubscriptionRow {
  id: string;
  entity_id: string;
  entity_type: 'contractor' | 'corporation';
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
    apiFetch<{ mode: string; tier: SubscriptionTier; status: SubscriptionStatus; current_period_end: string }>(
      '/payments/subscriptions/start',
      { method: 'POST', body: JSON.stringify({ tier }) },
    ),

  cancel: () =>
    apiFetch<{ status: 'cancelled' }>(
      '/payments/subscriptions/cancel',
      { method: 'POST' },
    ),
};

export const paymentApi = {
  /** List payment methods for the authenticated entity (from JWT context). */
  methods: () =>
    apiFetch<PaymentMethod[]>('/payments/payment-methods'),

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
