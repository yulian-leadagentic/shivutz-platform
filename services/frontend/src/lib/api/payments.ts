import { apiFetch } from './client';
import type {
  PaymentMethod,
  CommitEngagementResult,
  PaymentTransactionRow,
} from '@/types';

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

  /**
   * Initiate the J5 pre-authorization for a deal.
   *
   * Real mode → returns `redirect_url`; caller must redirect the user to
   *             Cardcom's hosted form and then call `completeAuth` on return.
   * Fake mode → returns `fake_mode: true, redirect_url: null` and the
   *             transaction is already authorized; caller can skip the redirect.
   */
  commitEngagement: (dealId: string) =>
    apiFetch<CommitEngagementResult>(
      `/payments/deals/${dealId}/commit-engagement`,
      { method: 'POST' }
    ),

  /**
   * After Cardcom redirects the user back, call this with the low_profile_id
   * query param so the backend can verify the J5 succeeded and flip the
   * transaction to authorized.
   */
  completeAuth: (dealId: string, lowProfileId: string) =>
    apiFetch<PaymentTransactionRow>(
      `/payments/deals/${dealId}/complete-auth`,
      { method: 'POST', body: JSON.stringify({ low_profile_id: lowProfileId }) }
    ),

  /** Void the J5 hold within the grace window. Owner-corp or admin. */
  cancelEngagement: (dealId: string, reason?: string) =>
    apiFetch<{ transaction_id: string; status: string }>(
      `/payments/deals/${dealId}/cancel-engagement`,
      { method: 'POST', body: JSON.stringify({ reason: reason ?? null }) }
    ),

  /** Get the current payment transaction status for a deal. */
  dealPaymentStatus: (dealId: string) =>
    apiFetch<{ deal_id: string; payment_status: string | null; total_amount?: number }>(
      `/payments/deals/${dealId}/payment-status`
    ),

  /** Preview the commission breakdown for a deal without creating a transaction. */
  previewCommission: (dealId: string) =>
    apiFetch<{ deal_id: string; amounts: { base_amount: number; vat_rate: number; vat_amount: number; total_amount: number } }>(
      `/payments/deals/${dealId}/preview-commission`
    ),

  /** Full transaction row. Used post-capture to surface the
   *  invoice URL, clearance auth code and charge amount on the
   *  deal detail page. The backend returns the full row from
   *  payment_db.payment_transactions; we type-narrow to the
   *  fields the UI actually consumes. */
  getTransaction: (txId: string) =>
    apiFetch<PaymentTransactionRow & {
      invoice_number?: string | null;
      invoice_url?: string | null;
      invoice_issued_at?: string | null;
      provider_response_code?: string | null;
      provider_transaction_id?: string | null;
      charged_at?: string | null;
      base_amount?: number;
      vat_amount?: number;
      total_amount?: number;
    }>(`/payments/transactions/${txId}`),
};
