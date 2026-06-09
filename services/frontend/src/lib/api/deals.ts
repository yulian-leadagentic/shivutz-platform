import { apiFetch } from './client';
import type {
  Deal,
  Message,
  Worker,
  DealCreate,
  DealReport,
  PaginatedResponse,
} from '@/types';

/**
 * Normalise a list response into the paginated envelope shape regardless
 * of whether the backend has been upgraded to emit it yet. Accepts either
 * `{items, page, page_size, total}` OR a bare array (legacy shape).
 *
 * This is transitional — once every backend service is rebuilt with the
 * M6 changes, the bare-array branch is dead code and can be removed.
 */
function ensureEnvelope<T>(res: PaginatedResponse<T> | T[]): PaginatedResponse<T> {
  if (Array.isArray(res)) {
    return { items: res, page: 1, page_size: res.length, total: res.length };
  }
  return res;
}

export const dealApi = {
  /**
   * List deals visible to the caller.
   * Returns a paginated envelope; callers that just want the array should read `.items`.
   */
  list: (params?: { page?: number; page_size?: number }) => {
    const qs = new URLSearchParams();
    if (params?.page)      qs.set('page', String(params.page));
    if (params?.page_size) qs.set('page_size', String(params.page_size));
    const query = qs.toString();
    return apiFetch<PaginatedResponse<Deal> | Deal[]>(`/deals${query ? '?' + query : ''}`)
      .then(ensureEnvelope);
  },
  get: (id: string) => apiFetch<Deal>(`/deals/${id}`),
  create: (data: DealCreate) =>
    apiFetch<Deal>('/deals', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  messages: (id: string) =>
    apiFetch<Message[]>(`/deals/${id}/messages`),
  sendMsg: (id: string, content: string) =>
    apiFetch<Message>(`/deals/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  report: (id: string, data: DealReport) =>
    apiFetch<{ deal_id: string; status: string }>(`/deals/${id}/report`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  workers: (id: string) =>
    apiFetch<Worker[]>(`/deals/${id}/workers`),

  /** Corp-initiated proposal — create (or reuse) a 'proposed' deal for
   *  the (acting corp, search_id) pair. Idempotent on the server: if a
   *  deal already exists for this pair, returns its id with reused=true. */
  fromSearch: (searchId: string) =>
    apiFetch<{ id: string; status: string; reused: boolean }>(
      `/deals/from-search/${searchId}`, { method: 'POST' }
    ),

  // ── New deal lifecycle (replaces updateStatus + updateWorkers) ──────────
  commit: (id: string, workerIds: string[]) =>
    apiFetch<{ id: string; status: string; expires_at: string; commission_amount: number }>(
      `/deals/${id}/commit`, { method: 'POST', body: JSON.stringify({ worker_ids: workerIds }) }
    ),
  /** Step 1 of the contractor's post-proposal flow. Unlocks corp
   *  identity without changing deal status (stays 'corp_committed').
   *  Sets `corp_revealed_at` so the UI can route into the
   *  "now-talk-to-them, then approve" view. */
  revealCorp: (id: string) =>
    apiFetch<{ id: string; status: string; corp_revealed_at: string }>(
      `/deals/${id}/reveal-corp`, { method: 'POST' }
    ),
  /** Step 2 of the contractor's post-proposal flow. Formal commit —
   *  status flips to 'approved', capture timer starts. */
  approve: (id: string) =>
    apiFetch<{ id: string; status: string; scheduled_capture_at: string }>(
      `/deals/${id}/approve`, { method: 'POST' }
    ),
  reject: (id: string) =>
    apiFetch<{ id: string; status: string }>(
      `/deals/${id}/reject`, { method: 'POST' }
    ),
  /** Contractor close-the-loop: yes, the deal actually closed. */
  contractorConfirmClosed: (id: string) =>
    apiFetch<{ id: string; status: string }>(
      `/deals/${id}/contractor-confirm-closed`, { method: 'POST' }
    ),
  /** Contractor close-the-loop: no, the deal did NOT close + reason. */
  contractorDeclineClosed: (id: string, reason: string) =>
    apiFetch<{ id: string; status: string }>(
      `/deals/${id}/contractor-decline-closed`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }
    ),
  cancel: (id: string, reason?: string) =>
    apiFetch<{ id: string; status: string }>(
      `/deals/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: reason || null }) }
    ),
  /** Contractor withdraws an in-flight deal (proposed / corp_committed).
   *  Used by the "close other bids" action when one corp has already
   *  fulfilled the full requested quantity. */
  contractorCancel: (id: string, reason?: string) =>
    apiFetch<{ id: string; status: string }>(
      `/deals/${id}/contractor-cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason || null }),
      }
    ),
  replaceWorker: (id: string, oldWorkerId: string, newWorkerId: string) =>
    apiFetch<{ id: string; status: string; material_change: boolean }>(
      `/deals/${id}/replace_worker`, {
        method: 'POST',
        body: JSON.stringify({ old_worker_id: oldWorkerId, new_worker_id: newWorkerId }),
      }
    ),
};
