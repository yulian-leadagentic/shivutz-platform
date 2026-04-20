import { apiFetch } from './client';
import type { Contractor, Corporation } from '@/types';

export const orgApi = {
  registerContractor: (data: unknown) =>
    apiFetch('/organizations/contractors', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  registerCorporation: (data: unknown) =>
    apiFetch('/organizations/corporations', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getContractor: (id: string) =>
    apiFetch<Contractor>(`/organizations/contractors/${id}`),
  getCorporation: (id: string) =>
    apiFetch<Corporation>(`/organizations/corporations/${id}`),
};
