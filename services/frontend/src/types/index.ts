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
  origin_country: string;
  languages: string[];
  visa_valid_until: string;
  status: string;
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
}

export interface MatchedWorker {
  worker_id: string;
  worker_name: string;
  profession_type: string;
  score: number;
  visa_valid_until: string;
}

export interface MatchBundle {
  corporation_id: string;
  corporation_name: string;
  workers: MatchedWorker[];
  score: number;
  is_complete: boolean;
}

export interface Deal {
  id: string;
  request_line_item_id: string;
  contractor_id: string;
  corporation_id: string;
  workers_count: number;
  agreed_price?: number;
  status: string;
  created_at: string;
}

export interface Message {
  id: string;
  deal_id: string;
  sender_user_id: string;
  sender_role: string;
  content: string;
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
}
