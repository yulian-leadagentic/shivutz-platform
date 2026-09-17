import { apiFetch } from './client';
import type {
  Contractor,
  Corporation,
  ContractorRegistration,
  CorporationRegistration,
  RegistrationResult,
  RegistryLookupResult,
  CorporationLookupResult,
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
  /** U7 · service provider self-registration. Auto-active, no gov-registry
   *  cross-check. OTP was verified in the preceding /auth/send-otp step
   *  (auth service checks recent-OTP internally). */
  registerProvider: (data: {
    name:            string;
    contact_name:    string;
    contact_phone:   string;
    business_number: string;   // R5 §2a · required (was optional)
    email?:          string;
    city?:           string;
    region?:         string;
    website?:        string;
    description?:    string;
    logo_url?:       string;
    whatsapp_opt_in?: boolean;
  }) =>
    apiFetch<{
      id:            string;
      name:          string;
      status:        'active';
      org_type:      'service_provider';
      access_token?: string;
      refresh_token?: string;
    }>('/organizations/providers/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getContractor: (id: string) =>
    apiFetch<Contractor>(`/organizations/contractors/${id}`),
  getCorporation: (id: string) =>
    apiFetch<Corporation>(`/organizations/corporations/${id}`),

  // ── Verification ─────────────────────────────────────────────────────────
  lookupContractorBusiness: (business_number: string, phone: string) =>
    apiFetch<RegistryLookupResult>('/organizations/contractors/lookup', {
      method: 'POST',
      body: JSON.stringify({ business_number, phone }),
    }),
  lookupCorporationBusiness: (business_number: string, phone: string) =>
    apiFetch<CorporationLookupResult>('/organizations/corporations/lookup', {
      method: 'POST',
      body: JSON.stringify({ business_number, phone }),
    }),
  verifyStart: (contractor_id: string, channel: 'email' | 'sms', target: string) =>
    apiFetch<{ ok: boolean; channel: string; expires_at: string }>(
      `/organizations/contractors/${contractor_id}/verify/start`,
      {
        method: 'POST',
        body: JSON.stringify({ channel, target }),
      },
    ),
  verifyConfirm: (contractor_id: string, channel: 'email' | 'sms', secret: string) =>
    apiFetch<{ ok: boolean; tier: string; method: string }>(
      `/organizations/contractors/${contractor_id}/verify/confirm`,
      {
        method: 'POST',
        body: JSON.stringify({ channel, secret }),
      },
    ),

  /** Backfill flow — existing contractors submit their kablan_number
   *  here to prove ownership. Match → bumped to tier_2. Mismatch (or
   *  registry unreachable) → row stays pending, response carries the
   *  reason so the UI can show 'we'll review' vs 'try again'. */
  verifyKablan: (contractor_id: string, kablan_number: string) =>
    apiFetch<{ ok: true; matched: boolean; tier?: string; reason?: string }>(
      `/organizations/contractors/${contractor_id}/verify-kablan`,
      {
        method: 'POST',
        body: JSON.stringify({ kablan_number }),
      },
    ),
};
