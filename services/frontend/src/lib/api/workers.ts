import { apiFetch } from './client';
import type { Worker } from '@/types';

export const workerApi = {
  list: (corporationId?: string) => {
    const qs = corporationId ? `?corporation_id=${corporationId}` : '';
    return apiFetch<Worker[]>(`/workers${qs}`);
  },
  get: (id: string) => apiFetch<Worker>(`/workers/${id}`),
  create: (data: unknown) =>
    apiFetch<Worker>('/workers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: unknown) =>
    apiFetch<Worker>(`/workers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    apiFetch<void>(`/workers/${id}`, { method: 'DELETE' }),
  bulkCreate: (data: unknown) =>
    apiFetch<{ created: number; ids: string[] }>('/workers/bulk', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
