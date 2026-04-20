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
  classification: 'general' | 'specialty' | 'infrastructure';
  operating_regions: string[];
  approval_status: 'pending' | 'approved' | 'rejected';
  contact_name: string;
  contact_email: string;
  contact_phone: string;
}

export interface Worker {
  id: string;
  corporation_id: string;
  first_name: string;
  last_name: string;
  profession_type: string;
  experience_years: number;
  experience_range?: string;  // month-based: '0-6' | '6-12' | '12-24' | '24-36' | '36+'
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

export interface JobLineItem {
  id: string;
  request_id: string;
  profession_type: string;
  quantity: number;
  start_date: string;
  end_date: string;
  min_experience: number;
  required_languages: string[];
  origin_preference: string[];
  status: string;
}

export interface JobLineItemSummary {
  id: string;
  profession_type: string;
  quantity: number;
  status: string;
}

export interface JobRequest {
  id: string;
  contractor_id: string;
  project_name: string;
  project_name_he: string;
  region: string;
  status: string;
  line_items: JobLineItem[];
  created_at?: string;
  address?: string;
  project_start_date?: string;
  project_end_date?: string;
  professions_count?: number;
  total_workers?: number;
  /** -1 = no match run yet; 0-100 = fill percentage from best bundle */
  best_fill_pct?: number;
  best_is_complete?: boolean;
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
  line_item_id: string;
  match_tier: string;      // "perfect" | "good" | "partial"
  matched_criteria: string[];
  missing_criteria: string[];
}

export interface LineItemFill {
  line_item_id: string;
  profession: string;
  needed: number;
  workers: WorkerMatchResult[];
  is_filled: boolean;
}

export interface MatchBundle {
  corporation_id: string;
  corporation_name?: string;   // resolved client-side after fetch
  threshold_requirements?: Record<string, unknown> | null;  // resolved client-side
  line_items: LineItemFill[];
  total_score: number;
  is_complete: boolean;
  fill_percentage: number;     // 0-100
  filled_workers: number;
  needed_workers: number;
}

export interface Deal {
  id: string;
  request_line_item_id: string;
  contractor_id: string;
  corporation_id: string;
  workers_count: number;
  agreed_price?: number;
  status: string;
  notes?: string;
  created_at: string;
  standard_contract_url?: string;
  standard_contract_doc_name?: string;
  payment_status?: string;
  payment_amount_estimated?: number;
  corp_committed_at?: string;
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
  countries_of_origin: string[];
  minimum_contract_months: number;
  approval_status: 'pending' | 'approved' | 'rejected' | 'suspended';
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  threshold_requirements?: Record<string, unknown> | null;
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

// ─── API request bodies ────────────────────────────────────────────────────

export interface ContractorRegistration {
  company_name_he: string;
  business_number: string;
  classification: 'general' | 'specialty' | 'infrastructure';
  operating_regions: string[];
  contact_name: string;
  contact_phone: string;
  contact_email?: string;
}

export interface CorporationRegistration {
  company_name_he: string;
  business_number: string;
  countries_of_origin: string[];
  minimum_contract_months: number;
  contact_name: string;
  contact_phone: string;
  contact_email?: string;
}

export interface RegistrationResult {
  id: string;
  status: string;
  org_type: string;
  access_token?: string;
  refresh_token?: string;
}

export interface JobLineItemInput {
  profession_type: string;
  quantity: number;
  start_date: string;
  end_date: string;
  min_experience: number;
  min_experience_range?: string;
  min_experience_ranges?: string[];
  origin_preference: string[];
  required_languages: string[];
}

export interface JobRequestCreate {
  project_name_he: string;
  region: string;
  project_start_date?: string;
  project_end_date?: string;
  line_items: JobLineItemInput[];
}

export interface JobRequestUpdate {
  project_name_he?: string;
  region?: string;
  project_start_date?: string;
  project_end_date?: string;
}

export interface WorkerInput {
  first_name: string;
  last_name: string;
  profession_type: string;
  experience_range?: string;
  origin_country: string;
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
  job_request_id: string;
  corporation_id: string;
  worker_ids: string[];
  workers_count: number;
  notes?: string;
}

export interface DealReport {
  actual_workers: number;
  actual_start_date: string;
  actual_end_date: string;
  notes?: string;
}
