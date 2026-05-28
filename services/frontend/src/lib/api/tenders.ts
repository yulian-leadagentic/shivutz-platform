import { apiFetch } from './client';

// ── Foreign-worker import tenders ───────────────────────────────────
// A separate flow from deals: contractor publishes a multi-profession
// "import N foreign workers" tender, corps submit competing partial
// bids, contractor selects, admin approves + reveals identities.
// Double-blind until reveal — contractor sees "תאגיד N", corps see
// "קבלן".

export interface TenderItem {
  id: string;
  tender_id?: string;
  profession_type: string;
  quantity: number;
  min_experience: number;
  notes?: string | null;
}

export interface BidItem {
  id: string;
  bid_id?: string;
  tender_item_id: string;
  profession_type: string;
  quantity_offered: number;
  unit_price?: number | null;
}

export interface Bid {
  id: string;
  tender_id: string;
  corporation_id: string | null;     // null while masked
  corp_anon?: string;                // "תאגיד N" while masked
  total_price: number | null;
  currency: string;
  delivery_estimate_days: number | null;
  notes?: string | null;
  status: 'submitted' | 'selected' | 'confirmed' | 'rejected' | 'withdrawn';
  submitted_at: string;
  selected_at?: string | null;
  confirmed_at?: string | null;
  items: BidItem[];
  /** Present on /tenders/my-bids rows — the tender header the bid
   *  belongs to (contractor masked until reveal). */
  tender?: Tender;
}

export interface Tender {
  id: string;
  contractor_id: string | null;       // null while masked
  contractor_anon?: string;           // "קבלן" while masked
  title?: string | null;
  origin_country?: string | null;
  region?: string | null;
  target_start_date?: string | null;
  notes?: string | null;
  status: 'open' | 'selecting' | 'awaiting_admin' | 'in_progress' | 'closed' | 'cancelled';
  revealed_at?: string | null;
  created_at: string;
  items: TenderItem[];
  bids?: Bid[];                       // present on detail + admin views
  bid_count?: number;                 // contractor list summary
  my_bid?: Bid | null;                // corp open-list summary
  selected_bids?: Bid[];              // admin view
  tender?: Tender;                    // nested on corp's my-bids rows
}

export interface TenderCreatePayload {
  title?: string;
  origin_country?: string;
  region?: string;
  target_start_date?: string;
  notes?: string;
  items: Array<{ profession_type: string; quantity: number; min_experience?: number; notes?: string }>;
}

export interface BidCreatePayload {
  total_price?: number;
  currency?: string;
  delivery_estimate_days?: number;
  notes?: string;
  items: Array<{ tender_item_id: string; profession_type: string; quantity_offered: number; unit_price?: number }>;
}

export const tenderApi = {
  // Contractor
  create: (data: TenderCreatePayload) =>
    apiFetch<{ id: string; status: string }>('/tenders', {
      method: 'POST', body: JSON.stringify(data),
    }),
  listMine: () => apiFetch<Tender[]>('/tenders'),
  get: (id: string) => apiFetch<Tender>(`/tenders/${id}`),
  select: (id: string, bidIds: string[]) =>
    apiFetch<{ ok: boolean; status: string }>(`/tenders/${id}/select`, {
      method: 'POST', body: JSON.stringify({ bid_ids: bidIds }),
    }),
  cancel: (id: string) =>
    apiFetch<{ ok: boolean; status: string }>(`/tenders/${id}/cancel`, { method: 'POST' }),

  // Corp
  listOpen: () => apiFetch<Tender[]>('/tenders/open'),
  myBids: () => apiFetch<Bid[]>('/tenders/my-bids'),
  submitBid: (id: string, data: BidCreatePayload) =>
    apiFetch<{ id: string; status: string }>(`/tenders/${id}/bids`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  withdrawBid: (id: string) =>
    apiFetch<{ ok: boolean }>(`/tenders/${id}/bids/withdraw`, { method: 'POST' }),

  // Admin
  adminListAll: () => apiFetch<Tender[]>('/tenders/admin/all'),
  adminApprove: (id: string) =>
    apiFetch<{ ok: boolean; status: string; confirmed: number }>(`/tenders/${id}/admin/approve`, { method: 'POST' }),
  adminClose: (id: string) =>
    apiFetch<{ ok: boolean; status: string }>(`/tenders/${id}/admin/close`, { method: 'POST' }),
};
