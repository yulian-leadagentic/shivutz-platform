import { apiFetch } from './client';
import { orgApi } from './organizations';
import type { JobRequest, MatchBundle } from '@/types';

export const jobApi = {
  list: () => apiFetch<JobRequest[]>('/job-requests'),
  get: (id: string) => apiFetch<JobRequest>(`/job-requests/${id}`),
  create: (data: unknown) =>
    apiFetch<JobRequest>('/job-requests', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: unknown) =>
    apiFetch<{ id: string }>(`/job-requests/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  replaceLineItems: (id: string, lineItems: unknown[]) =>
    apiFetch<{ id: string; line_items_count: number }>(`/job-requests/${id}/line-items`, {
      method: 'PUT',
      body: JSON.stringify({ line_items: lineItems }),
    }),
  addLineItem: (id: string, lineItem: unknown) =>
    apiFetch<{ id: string }>(`/job-requests/${id}/line-items`, {
      method: 'POST',
      body: JSON.stringify(lineItem),
    }),
  match: async (id: string): Promise<MatchBundle[]> => {
    const res = await apiFetch<{ bundles: MatchBundle[] }>(`/job-requests/${id}/match`, { method: 'POST' });
    const bundles = res.bundles ?? [];
    // Resolve corporation names + threshold_requirements in parallel (best-effort)
    await Promise.allSettled(
      bundles.map(async (b) => {
        try {
          const corp = await orgApi.getCorporation(b.corporation_id);
          b.corporation_name = corp.company_name_he || corp.company_name;
          b.threshold_requirements = corp.threshold_requirements ?? null;
        } catch {
          b.corporation_name = b.corporation_id;
        }
      })
    );
    return bundles;
  },
};
