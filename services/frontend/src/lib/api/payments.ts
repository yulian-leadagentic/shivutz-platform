import { apiFetch } from './client';
import type { PaymentMethod, CommitEngagementResult } from '@/types';

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

  /** Get a Cardcom LowProfile tokenization URL to redirect the user to. */
  cardcomInit: () =>
    apiFetch<{ url: string; low_profile_id: string }>('/payments/cardcom-init'),

  /** Commit to a deal — creates a pending_charge transaction. */
  commitEngagement: (dealId: string) =>
    apiFetch<CommitEngagementResult>(
      `/payments/deals/${dealId}/commit-engagement`,
      { method: 'POST' }
    ),

  /** Get the current payment transaction status for a deal. */
  dealPaymentStatus: (dealId: string) =>
    apiFetch<{ deal_id: string; payment_status: string | null; total_amount?: number }>(
      `/payments/deals/${dealId}/payment-status`
    ),
};
