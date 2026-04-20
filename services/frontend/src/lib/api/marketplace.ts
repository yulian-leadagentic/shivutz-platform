import { apiFetch } from './client';
import type { MarketplaceListing, LeadFormData } from '@/types';

export const marketplaceApi = {
  list: (params?: {
    category?: string;
    region?: string;
    city?: string;
    min_capacity?: number;
    search?: string;
    mine?: boolean;
  }) => {
    const qs = new URLSearchParams();
    if (params?.category) qs.set('category', params.category);
    if (params?.region) qs.set('region', params.region);
    if (params?.city) qs.set('city', params.city);
    if (params?.min_capacity) qs.set('min_capacity', String(params.min_capacity));
    if (params?.search) qs.set('search', params.search);
    if (params?.mine) qs.set('mine', 'true');
    const query = qs.toString();
    return apiFetch<MarketplaceListing[]>(
      `/marketplace${query ? '?' + query : ''}`
    );
  },

  get: (id: string) =>
    apiFetch<MarketplaceListing>(`/marketplace/${id}`),

  create: (data: {
    category: string;
    title: string;
    description?: string;
    city?: string;
    region?: string;
    price?: number;
    price_unit?: string;
    capacity?: number;
    is_furnished?: boolean;
    available_from?: string;
    contact_phone?: string;
    contact_name?: string;
    subcategory?: string;
  }) =>
    apiFetch<{ id: string; status: string }>('/marketplace', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<{
    title: string;
    description: string;
    city: string;
    region: string;
    price: number;
    price_unit: string;
    capacity: number;
    is_furnished: boolean;
    available_from: string;
    contact_phone: string;
    contact_name: string;
    status: string;
  }>) =>
    apiFetch<{ id: string; updated: boolean }>(`/marketplace/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  remove: (id: string) =>
    apiFetch<void>(`/marketplace/${id}`, { method: 'DELETE' }),
};

export const leadsApi = {
  submit: (data: LeadFormData) =>
    apiFetch<{ id: string; message: string }>('/marketplace/leads', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
