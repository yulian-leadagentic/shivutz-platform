import { apiFetch } from './client';
import type { Deal, Message, Worker, DealCreate, DealReport } from '@/types';

export const dealApi = {
  list: () => apiFetch<Deal[]>('/deals'),
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
