import { apiFetch } from './client';
import type {
  PaymentMethod,
  PaymentTransactionRow,
} from '@/types';

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

  /**
   * Get a Cardcom LowProfile tokenization URL to redirect the user to.
   *
   * `invoice_email` (optional) is the address where future invoices for
   * captured charges should be sent. Pre-launch, Cardcom invoices were
   * being issued with no `To` address — the email goes through to
   * Cardcom's InvoiceHead so the receipt actually reaches the corp.
   */
  cardcomInit: (invoice_email?: string) =>
    apiFetch<{ url: string; low_profile_id: string }>(
      '/payments/cardcom-init',
      invoice_email
        ? { method: 'POST', body: JSON.stringify({ invoice_email }) }
        : { method: 'GET' },
    ),

  /** Full transaction row. Kept for future subscription-invoice UI
   *  (post-Cardcom-recurring). D3 removed the deal-lifecycle callers
   *  (CapturedBadge etc.) but the endpoint remains valid for admin
   *  audit and any future subscription-receipt surface. */
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
