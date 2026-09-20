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
  | 'a11y_coordinator_email'
  // R21 §3 · number stored as string, parsed on the client.
  // Ceiling of 12 lives in ads.py:565 (server-side clamp).
  | 'sponsor_carousel_limit',
  string | null
>>;

export const legalApi = {
  /** null on 404 OR any non-Api error — caller falls back to bundled
   *  file (accessibility) or notFound() (terms/privacy).
   *
   *  U5 build-fix · Next 16's static prerender runs these Server
   *  Components in a Node process where fetch() insists on absolute
   *  URLs. BASE at build time is the relative `/api`, and Node throws
   *  `TypeError: Invalid URL` before we can even inspect the response.
   *  That TypeError is not an ApiError, so pre-fix it slipped past the
   *  404 guard and crashed the whole build (spec: docs/cc-prompts/
   *  cc_prompt_U5_anon_lockout.md — this was the mystery blocking the
   *  frontend redeploy).
   *
   *  Catching every failure (not just 404) is safe here because the
   *  callers already treat `null` as "no doc" and render the fallback.
   *  A real backend outage still shows the bundled accessibility file,
   *  or a `notFound()` for terms/privacy — same UX as a 404. */
  doc: async (slug: LegalSlug): Promise<LegalDoc | null> => {
    try {
      return await apiFetch<LegalDoc>(`/legal/${slug}`);
    } catch (e) {
      if (e instanceof ApiError && e.cause?.status === 404) return null;
      if (!(e instanceof ApiError)) return null;
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
