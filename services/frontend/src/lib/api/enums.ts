import { apiFetch } from './client';
import type { Profession } from '@/types';

export const enumApi = {
  professions: () => apiFetch<Profession[]>('/enums/professions'),
  regions: () =>
    apiFetch<{ code: string; name_he: string; name_en: string }[]>('/enums/regions'),
  origins: () =>
    apiFetch<{ code: string; name_he: string; name_en: string }[]>('/enums/origins'),
};
