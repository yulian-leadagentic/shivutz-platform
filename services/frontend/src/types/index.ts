export interface User {
  id: string;
  email: string;
  role: 'admin' | 'contractor' | 'corporation' | 'staff';
  org_id?: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface Contractor {
  id: string;
  company_name: string;
  company_name_he: string;
  business_number: string;
  kablan_number?: string | null;
  kvutza?: string | null;
  sivug?: number | null;
  gov_branch?: string | null;
  gov_company_status?: string | null;
  verification_tier: 'tier_0' | 'tier_1' | 'tier_2';
  verification_method?: 'email' | 'sms' | 'manual' | 'none' | null;
  operating_regions: string[];
  approval_status: 'pending' | 'approved' | 'rejected';
  contact_name: string;
  contact_email: string;
  contact_phone: string;
}

export interface Worker {
  id: string;
  corporation_id: string;
  internal_id?: string | null;       // EMP-XXXXXXXX (auto-generated, system-wide unique)
  first_name: string;
  last_name: string;
  profession_type: string;
  experience_years: number;
  experience_range?: string;  // month-based: '0-6' | '6-12' | '12-24' | '24-36' | '36+'
  years_in_israel?: number | null;
  origin_country: string;
  languages: string[];
  visa_valid_until: string;
  status: string;
  extra_fields?: {
    available_region?: string;
    available_from?: string;
    [key: string]: unknown;
  };
}

// ─── Worker-search types (Wave 3 — replaces project + line-items) ─────────────
//
// A WorkerSearch is a contractor's standalone request for N workers of a
// given profession starting on a date. No project umbrella.

export type RecruitmentType = 'domestic' | 'foreign';

export interface WorkerSearch {
  id: string;
  contractor_id: string;
  recruitment_type: RecruitmentType;
  region?: string;
  address?: string;
  profession_type: string;
  quantity: number;
  start_date: string;
  end_date: string;
  min_experience: number;
  required_languages: string[];
  origin_preference: string[];
  special_requirements?: string;
  status: string;
  created_at?: string;
  /** -1 = no match run yet; 0-100 = fill percentage from best corp */
  best_fill_pct?: number;
  best_is_complete?: boolean;
}

export interface WorkerSearchCreate {
  recruitment_type: RecruitmentType;
  profession_type: string;
  quantity: number;
  start_date: string;
  end_date?: string;
  region?: string;
  address?: string;
  min_experience?: number;
  origin_preference?: string[];
  required_languages?: string[];
}

export interface WorkerSearchUpdate {
  quantity?: number;
  start_date?: string;
  end_date?: string;
  region?: string;
  min_experience?: number;
  status?: string;
}

// ─── Match types (Go job-match service response) ──────────────────────────────

export interface MatchedWorkerDetail {
  id: string;
  corporation_id: string;
  profession_type: string;
  experience_years: number;
  origin_country: string;
  languages: string[];
  visa_valid_until?: string;
  status: string;
  available_region?: string;
}

export interface WorkerMatchResult {
  worker: MatchedWorkerDetail;
  score: number;           // raw 0-110
  search_id: string;
  match_tier: string;      // "perfect" | "good" | "partial"
  matched_criteria: string[];
  missing_criteria: string[];
}

// CorpMatch — for a single search, a single corporation's offer of
// up to N workers. The matcher returns a sorted list of these per
// search (one entry per corp that has any matching worker).
export interface CorpMatch {
  search_id: string;
  corporation_id: string;
  corporation_name?: string;   // resolved client-side after fetch
  threshold_requirements?: Record<string, unknown> | null;
  profession: string;
  needed: number;
  workers: WorkerMatchResult[];
  filled_workers: number;
  is_complete: boolean;
  fill_percentage: number;     // 0-100
  total_score: number;
}

export interface Deal {
  id: string;
  search_id: string;
  contractor_id: string | null;   // null when info-disclosure hides the counter-party
  corporation_id: string | null;  // null when info-disclosure hides the counter-party
  status: string;
  notes?: string;
  created_at: string;
  // Lifecycle (M2)
  commission_amount?: number | null;
  corp_committed_at?: string | null;
  approved_at?: string | null;
  rejected_at?: string | null;
  expires_at?: string | null;
  scheduled_capture_at?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: 'corp' | null;
  cancellation_reason?: string | null;
  closed_at?: string | null;
  // Enriched in list_deals via cross-DB join — visible to all parties.
  worker_count?: number;
  requested_count?: number;
  profession_type?: string | null;
  profession_he?: string | null;
  region_he?: string | null;
  // Legacy fields kept for older UIs that haven't been rewritten yet.
  workers_count?: number;
  agreed_price?: number;
  standard_contract_url?: string;
  standard_contract_doc_name?: string;
  payment_status?: string;
  payment_amount_estimated?: number;
  /** ID of the active payment transaction (the one that's been
   *  authorized for this deal). Returned by /deals/{id} + the list
   *  endpoints. Used to fetch the captured transaction for the
   *  CapturedBadge invoice/auth-code display. */
  active_payment_transaction_id?: string | null;
  /** Last-modified timestamp. Returned everywhere; used by the
   *  admin dashboard's "sort by recent activity" column. */
  updated_at?: string;
}

export interface Message {
  id: string;
  deal_id: string;
  sender_user_id: string;
  sender_role: string;
  content: string;
  content_type?: 'text' | 'system';
  created_at: string;
}

export interface Profession {
  code: string;
  name_he: string;
  name_en: string;
  is_active: boolean;
}

export interface Region {
  code: string;
  name_he: string;
  name_en: string;
}

export interface Corporation {
  id: string;
  company_name: string;
  company_name_he: string;
  business_number: string;
  gov_company_status?: string | null;
  verification_tier: 'tier_0' | 'tier_1' | 'tier_2';
  verification_method?: 'email' | 'sms' | 'manual' | 'none' | null;
  countries_of_origin: string[];
  minimum_contract_months: number;
  approval_status: 'pending' | 'approved' | 'rejected' | 'suspended';
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  threshold_requirements?: Record<string, unknown> | null;
}

export interface CorporationLookupResult {
  ok: boolean;
  blocked?: boolean;
  block_reason?: string | null;
  ica_found?: boolean;
  gov_company_status?: string | null;
  prefill?: {
    company_name_he?: string | null;
  };
  error?: string;
  message?: string;
}

export interface PaymentMethod {
  id: string;
  entity_type: string;
  entity_id: string;
  provider: string;
  last_4_digits: string;
  card_brand: string | null;
  card_holder_name: string | null;
  expiry_month: number;
  expiry_year: number;
  is_default: boolean;
  status: string;
  created_at: string | null;
  last_used_at: string | null;
}

export interface CommitEngagementResult {
  transaction_id: string;
  status: string;
  grace_period_expires_at: string;
  amounts: {
    base_amount: number;
    vat_rate: number;
    vat_amount: number;
    total_amount: number;
  };
  /** Pattern A (J5): when true, the backend ran in PAYMENT_FAKE_MODE and
   *  the transaction is already authorized — the frontend can skip the
   *  Cardcom redirect step. */
  fake_mode?: boolean;
  low_profile_id?: string;
  /** Pattern A (J5): URL to redirect the user to for card entry. Null in
   *  fake mode. */
  redirect_url?: string | null;
}

export interface PaymentTransactionRow {
  id: string;
  deal_id: string;
  status: string;
  total_amount: number | null;
  vat_amount: number | null;
  base_amount: number | null;
  grace_period_expires_at: string | null;
  auth_provider_deal_id: string | null;
  authorized_at: string | null;
  auth_expires_at: string | null;
  charged_at: string | null;
  cancelled_at: string | null;
  last_capture_error: string | null;
  retry_count: number;
}

export interface MarketplaceListing {
  id: string;
  corporation_id: string;
  corporation_name?: string;
  is_corporation_verified?: boolean;
  category: 'housing' | 'equipment' | 'services' | 'other';
  subcategory?: string;
  title: string;
  description?: string;
  city?: string;
  region?: string;
  price?: number;
  price_unit?: 'per_month' | 'per_night' | 'fixed' | 'negotiable';
  capacity?: number;
  is_furnished?: boolean;
  available_from?: string;
  status: 'active' | 'rented' | 'sold' | 'paused';
  contact_phone?: string;
  contact_name?: string;
  images_json?: string[];
  created_at: string;
  updated_at: string;
}

export interface LeadFormData {
  full_name: string;
  phone: string;
  org_type: 'contractor' | 'corporation';
  notes?: string;
}

// ─── API response envelopes ────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
}

// ─── API request bodies ────────────────────────────────────────────────────

export interface ContractorRegistration {
  company_name_he: string;
  business_number: string;
  operating_regions: string[];
  contact_name: string;
  contact_phone: string;
  contact_email?: string;
}

export interface RegistryChannel {
  type: 'email' | 'sms';
  target: string;
}

export interface RegistryLookupResult {
  ok: boolean;
  blocked?: boolean;
  block_reason?: string | null;
  pinkash_found?: boolean;
  ica_found?: boolean;
  gov_company_status?: string | null;
  prefill?: {
    company_name_he?: string | null;
    kvutza?: string | null;
    sivug?: number | null;
    gov_branch?: string | null;
    kablan_number?: string | null;
  };
  channels?: RegistryChannel[];
  error?: string;
  message?: string;
}

export interface CorporationRegistration {
  company_name_he: string;
  business_number: string;
  countries_of_origin: string[];
  minimum_contract_months: number;
  contact_name: string;
  contact_phone: string;
  contact_email?: string;
  tc_version?: string;
}

export interface RegistrationResult {
  id: string;
  status: string;
  org_type: string;
  verification_tier?: 'tier_0' | 'tier_1' | 'tier_2';
  registry_found?: boolean;
  available_channels?: RegistryChannel[];
  access_token?: string;
  refresh_token?: string;
}

// (Wave 3) JobLineItemInput / JobRequestCreate / JobRequestUpdate were
// removed — replaced by WorkerSearchCreate / WorkerSearchUpdate above.

// Wave 2 (2026-05): origin_country + experience_range relaxed to
// optional/nullable (corp can leave them blank — "לא צויין").
// available_region kept on the type for API compatibility but the form
// no longer sends it.
export interface WorkerInput {
  first_name: string;
  last_name: string;
  profession_type: string;
  experience_range?: string | null;
  origin_country?: string | null;
  languages?: string[];
  visa_valid_until?: string | null;
  available_region?: string | null;
  available_from?: string | null;
  employee_number?: string | null;
}

// Update accepts any known mutable field plus an index signature for
// dynamic inline editors (`{ [updateKey]: val }`).
export type WorkerUpdate = Partial<WorkerInput> & {
  status?: string;
  [key: string]: unknown;
};

export interface DealCreate {
  search_id?: string;
  corporation_id: string;
  worker_ids?: string[];
  workers_count?: number;
  notes?: string;
}

export interface DealReport {
  actual_workers: number;
  actual_start_date: string;
  actual_end_date: string;
  notes?: string;
}
