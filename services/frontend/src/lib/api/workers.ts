import { apiFetch } from './client';
import type { Worker, WorkerInput, WorkerUpdate } from '@/types';

export const workerApi = {
  list: (corporationId?: string) => {
    const qs = corporationId ? `?corporation_id=${corporationId}` : '';
    return apiFetch<Worker[]>(`/workers${qs}`);
  },
  get: (id: string) => apiFetch<Worker>(`/workers/${id}`),
  create: (data: WorkerInput) =>
    apiFetch<Worker>('/workers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: WorkerUpdate) =>
    apiFetch<Worker>(`/workers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    apiFetch<void>(`/workers/${id}`, { method: 'DELETE' }),
  bulkCreate: (data: { workers: WorkerInput[] }) =>
    apiFetch<{ created: number; ids: string[] }>('/workers/bulk', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
