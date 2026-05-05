import type { ExperienceRange } from '@/i18n/he';

/** Form state for the worker single-add tab.
 *
 * Wave 2 (2026-05) per key-user feedback:
 * - `available_region` removed entirely — the corporation's regions
 *   already cover where workers can be placed; per-worker region was
 *   noise.
 * - The other fields (experience_range / origin_country / visa_valid_until)
 *   are typed as required strings but enforced as OPTIONAL by the
 *   form's validator — empty string means "לא צויין". */
export interface SharedFields {
  profession_type: string;
  experience_range: ExperienceRange | '';
  origin_country: string;
  languages: string[];
  visa_valid_until: string;
  available_from: string;
  employee_number: string;
}

export const EMPTY_SHARED: SharedFields = {
  profession_type: '',
  experience_range: '',
  origin_country: '',
  languages: [],
  visa_valid_until: '',
  available_from: '',
  employee_number: '',
};

export type Origin = { code: string; name_he: string; name_en: string };
export type Region = { code: string; name_he: string; name_en: string };
