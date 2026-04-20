import { apiFetch } from './client';
import type {
  Deal,
  Message,
  Worker,
  DealCreate,
  DealReport,
  PaginatedResponse,
} from '@/types';

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
    return apiFetch<PaginatedResponse<Deal>>(`/deals${query ? '?' + query : ''}`);
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
  updateWorkers: (id: string, workerIds: string[]) =>
    apiFetch<{ deal_id: string; assigned: number }>(`/deals/${id}/workers`, {
      method: 'PUT',
      body: JSON.stringify({ worker_ids: workerIds }),
    }),
  updateStatus: (id: string, status: string) =>
    apiFetch<Deal>(`/deals/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
};
