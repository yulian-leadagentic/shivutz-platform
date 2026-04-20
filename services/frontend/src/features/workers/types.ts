import type { ExperienceRange } from '@/i18n/he';

/** Form state shared between the "single" and "bulk" worker-creation tabs. */
export interface SharedFields {
  profession_type: string;
  experience_range: ExperienceRange | '';
  origin_country: string;
  languages: string[];
  visa_valid_until: string;
  available_region: string;
  available_from: string;
  employee_number: string;
}

export const EMPTY_SHARED: SharedFields = {
  profession_type: '',
  experience_range: '',
  origin_country: '',
  languages: [],
  visa_valid_until: '',
  available_region: '',
  available_from: '',
  employee_number: '',
};

export type Origin = { code: string; name_he: string; name_en: string };
export type Region = { code: string; name_he: string; name_en: string };
