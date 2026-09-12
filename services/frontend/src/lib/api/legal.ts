// L10 · legal_documents + site_settings client.
//
// Both endpoints are PUBLIC (gateway PUBLIC_PREFIXES entry).
// getLegalDoc returns null on 404 so the caller can fall back to a
// bundled file (spec §2 resolver).

import { apiFetch } from './client';
import { ApiError } from './client';

export type LegalSlug = 'terms' | 'privacy' | 'accessibility';

export interface LegalDoc {
  slug:         LegalSlug;
  title_he:     string;
  body_md:      string;
  version:      number;
  effective_at: string | null;
  is_draft:     boolean;
  updated_at:   string;
}

export type SiteSettings = Partial<Record<
  | 'company_legal_name'
  | 'company_number'
  | 'company_address'
  | 'support_email'
  | 'a11y_coordinator_name'
  | 'a11y_coordinator_phone'
  | 'a11y_coordinator_email',
  string | null
>>;

export const legalApi = {
  /** null on 404 — caller falls back to bundled file per §2. */
  doc: async (slug: LegalSlug): Promise<LegalDoc | null> => {
    try {
      return await apiFetch<LegalDoc>(`/legal/${slug}`);
    } catch (e) {
      if (e instanceof ApiError && e.cause?.status === 404) return null;
      throw e;
    }
  },
  settings: () => apiFetch<SiteSettings>('/legal/settings'),
};

// ── admin CRUD ───────────────────────────────────────────────────────
// Uses adminApi's base path via a direct apiFetch to /admin/legal/*.

export interface LegalDocAdmin extends LegalDoc {
  updated_by: string | null;
}

export interface LegalSettingAdmin {
  setting_key: string;
  setting_val: string | null;
  label_he:    string;
  updated_at:  string;
}

export interface LegalHistoryRow {
  id:          string;
  slug:        LegalSlug;
  version:     number;
  body_md:     string;
  replaced_at: string;
  replaced_by: string | null;
}

export const legalAdminApi = {
  listDocs:    () => apiFetch<LegalDocAdmin[]>('/admin/legal/documents'),
  getDoc:      (slug: LegalSlug) => apiFetch<LegalDocAdmin>(`/admin/legal/documents/${slug}`),
  updateDoc:   (slug: LegalSlug, patch: Partial<Pick<LegalDoc, 'title_he' | 'body_md' | 'effective_at' | 'is_draft'>>) =>
    apiFetch<LegalDocAdmin>(`/admin/legal/documents/${slug}`, {
      method: 'PATCH',
      body:   JSON.stringify(patch),
    }),
  history:     (slug: LegalSlug) =>
    apiFetch<LegalHistoryRow[]>(`/admin/legal/documents/${slug}/history`),
  listSettings: () => apiFetch<LegalSettingAdmin[]>('/admin/legal/settings'),
  updateSetting: (key: string, val: string | null) =>
    apiFetch<LegalSettingAdmin>(`/admin/legal/settings/${key}`, {
      method: 'PATCH',
      body:   JSON.stringify({ setting_val: val }),
    }),
};
