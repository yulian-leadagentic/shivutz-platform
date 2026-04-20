import { apiFetch } from './client';
import type {
  Contractor,
  Corporation,
  ContractorRegistration,
  CorporationRegistration,
  RegistrationResult,
} from '@/types';

export const orgApi = {
  registerContractor: (data: ContractorRegistration) =>
    apiFetch<RegistrationResult>('/organizations/contractors', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  registerCorporation: (data: CorporationRegistration) =>
    apiFetch<RegistrationResult>('/organizations/corporations', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getContractor: (id: string) =>
    apiFetch<Contractor>(`/organizations/contractors/${id}`),
  getCorporation: (id: string) =>
    apiFetch<Corporation>(`/organizations/corporations/${id}`),
};
