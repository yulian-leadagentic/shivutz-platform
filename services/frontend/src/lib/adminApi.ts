import { apiFetch } from './api';
import type { Deal, Worker } from '@/types';

// ── Commission types ────────────────────────────────────────────────────────

export interface Commission {
  id: string;
  deal_id: string;
  gross_amount: number;
  commission_rate: number;
  commission_amount: number;
  invoice_number?: string;
  invoice_date?: string;
  invoice_url?: string;
  notes?: string;
  status: 'pending' | 'invoiced' | 'paid' | 'disputed';
  created_by: string;
  created_at: string;
}

export interface DealReport {
  id: string;
  deal_id: string;
  reported_by: 'contractor' | 'corporation';
  actual_workers: number;
  actual_start_date: string;
  actual_end_date: string;
  actual_days: number;
  notes?: string;
  submitted_at: string;
}

export interface AdminDealDetail extends Deal {
  contractor_name: string;
  corporation_name: string;
  reports: DealReport[];
  commission: Commission | null;
  workers: Worker[];
  discrepancy_flag: boolean;
  discrepancy_details?: string;
  start_date?: string;
  end_date?: string;
}

export interface PendingOrg {
  id: string;
  company_name: string;
  company_name_he: string;
  contact_email: string;
  contact_name: string;
  contact_phone: string;
  business_number: string;
  approval_sla_deadline: string;
  created_at: string;
  org_type: 'contractor' | 'corporation';
  commission_per_worker_amount?: number | null;
  // Contractor-only verification fields (NULL for corporations)
  kablan_number?: string | null;
  kvutza?: string | null;
  sivug?: number | null;
  gov_branch?: string | null;
  gov_company_status?: string | null;
  verification_tier?: 'tier_0' | 'tier_1' | 'tier_2' | null;
  verification_method?: 'email' | 'sms' | 'manual' | 'none' | null;
}

export interface OrgEditPayload {
  company_name_he?: string;
  company_name?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  commission_per_worker_amount?: number;
  notes?: string;
  // Registry / business fields
  business_number?: string;
  gov_company_status?: string;
  // Contractor-only
  kablan_number?: string;
  kvutza?: string;
  sivug?: number;
  gov_branch?: string;
  // Corporation-only
  countries_of_origin?: string[];
  minimum_contract_months?: number;
}

export interface OrgAuditEntry {
  log_id: string;
  actor_id: string | null;
  action: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface VATPeriod {
  id: string;
  percent: number;
  valid_from: string;        // ISO date
  valid_until: string | null;
  notes: string | null;
  created_at: string;
  created_by_user_id: string | null;
}

export interface Lead {
  id: string;
  full_name: string;
  phone: string;
  org_type: 'contractor' | 'corporation';
  source: string | null;
  notes: string | null;
  handled_at: string | null;
  handled_by_user_id: string | null;
  created_at: string;
}

export interface AdminUser {
  id: string;
  email: string | null;
  phone: string | null;
  full_name: string | null;
  role: 'admin' | 'contractor' | 'corporation' | string;
  auth_method: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  org_id: string | null;
  org_type: 'contractor' | 'corporation' | null;
  org_name: string | null;
}

export interface DashOrgs {
  approved: number;
  pending: number;
  rejected: number;
  suspended: number;
  total: number;
}

export interface DashWorkers {
  available: number;
  assigned: number;
  on_leave: number;
  deactivated: number;
  total: number;
}

export interface DashWorkersByProf {
  code: string;
  name_he: string;
  total: number;
  available: number;
  assigned: number;
}

export interface DashDemandByProf {
  code: string;
  name_he: string;
  demand_qty: number;
  open_requests: number;
}

export interface DashWaitingForContractor {
  id: string;
  contractor_id: string;
  corporation_id: string;
  commission_amount: number | null;
  corp_committed_at: string | null;
  expires_at: string | null;
  hours_waiting: number | null;
  worker_count: number;
}

export interface DashWaitingForCapture {
  id: string;
  contractor_id: string;
  corporation_id: string;
  commission_amount: number | null;
  approved_at: string | null;
  scheduled_capture_at: string | null;
  hours_until_capture: number | null;
  worker_count: number;
}

export interface DashDealQueues {
  by_status: Record<string, number>;
  waiting_for_contractor: DashWaitingForContractor[];
  waiting_for_capture: DashWaitingForCapture[];
}

export interface AdminDashboard {
  // Legacy fields for older widgets (keep for back-compat).
  pending_approvals: number;
  pending_contractors: number;
  pending_corporations: number;
  open_job_requests: number;
  active_deals: number;
  discrepancy_alerts: number;
  completed_deals: number;
  // New rich fields.
  contractors: DashOrgs;
  corporations: DashOrgs;
  workers: DashWorkers;
  workers_by_profession: DashWorkersByProf[];
  demand_by_profession: DashDemandByProf[];
  idle_professions: DashWorkersByProf[];
  deal_queues: DashDealQueues;
  as_of: string;
}

export interface AdminAlerts {
  discrepancy_alerts: Array<{
    id: string;
    contractor_id: string;
    corporation_id: string;
    discrepancy_details: string;
    updated_at: string;
  }>;
  sla_warnings: PendingOrg[];
}

export const adminApi = {
  dashboard: () => apiFetch<AdminDashboard>('/admin/dashboard'),
  alerts:    () => apiFetch<AdminAlerts>('/admin/alerts'),

  pendingApprovals: () => apiFetch<PendingOrg[]>('/admin/pending-approvals'),

  getOrg: (id: string, orgType: string) =>
    apiFetch<PendingOrg & Record<string, unknown>>(`/admin/orgs/${id}?org_type=${orgType}`),

  decide: (id: string, orgType: string, approved: boolean, reason?: string,
           commission_per_worker_amount?: number) =>
    apiFetch<{ id: string; status: string; company_name: string }>(
      `/admin/approvals/${id}?org_type=${orgType}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          approved,
          reason: reason || null,
          commission_per_worker_amount: commission_per_worker_amount ?? null,
        }),
      }
    ),

  editOrg: (id: string, orgType: string, data: OrgEditPayload) =>
    apiFetch<{ id: string; updated_fields: string[] }>(
      `/admin/orgs/${id}/edit?org_type=${orgType}`,
      { method: 'PATCH', body: JSON.stringify(data) }
    ),

  orgAudit: (id: string, orgType: string) =>
    apiFetch<OrgAuditEntry[]>(`/admin/orgs/${id}/audit?org_type=${orgType}`),

  uploadOrgDocument: async (orgType: 'contractor' | 'corporation', orgId: string,
                            file: File, docType = 'other', notes?: string) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('doc_type', docType);
    if (notes) fd.append('notes', notes);
    // Hits the gateway → user-org's authenticated upload endpoint.
    const token = (typeof window !== 'undefined') ? window.localStorage.getItem('access_token') : null;
    const res = await fetch(`/api/organizations/${orgType}s/${orgId}/documents/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    if (!res.ok) throw new Error(`upload_failed: ${res.status}`);
    return res.json();
  },

  allOrgs: () => apiFetch<PendingOrg[]>('/admin/approved-orgs'),

  allDeals: () => apiFetch<Deal[]>('/deals'),

  getDeal: (id: string) => apiFetch<AdminDealDetail>(`/admin/deals/${id}`),

  createCommission: (dealId: string, data: {
    gross_amount: number;
    commission_rate: number;
    invoice_number?: string;
    invoice_date?: string;
    invoice_url?: string;
    notes?: string;
  }) =>
    apiFetch<Commission>(`/admin/deals/${dealId}/commission`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateCommissionStatus: (commissionId: string, data: {
    status: string;
    invoice_number?: string;
    invoice_date?: string;
    invoice_url?: string;
  }) =>
    apiFetch<{ id: string; status: string }>(`/admin/commissions/${commissionId}/status`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // ── VAT periods ──────────────────────────────────────────────────────────

  listVatPeriods: () => apiFetch<VATPeriod[]>('/admin/vat-periods'),
  addVatPeriod: (data: { percent: number; valid_from: string; valid_until?: string | null; notes?: string }) =>
    apiFetch<VATPeriod>('/admin/vat-periods', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteVatPeriod: (id: string) =>
    apiFetch<void>(`/admin/vat-periods/${id}`, { method: 'DELETE' }),

  // ── Platform users + admin user creation ────────────────────────────────

  listUsers: (role?: 'admin' | 'contractor' | 'corporation') =>
    apiFetch<AdminUser[]>(`/admin/users${role ? `?role=${role}` : ''}`),
  addAdminUser: (data: { full_name: string; phone: string }) =>
    apiFetch<AdminUser>('/admin/users/admin', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  disableUser: (id: string) =>
    apiFetch<void>(`/admin/users/${id}/disable`, { method: 'PATCH' }),
  enableUser: (id: string) =>
    apiFetch<void>(`/admin/users/${id}/enable`, { method: 'PATCH' }),

  // ── Org status (suspend / reactivate) ──────────────────────────────────
  setOrgStatus: (id: string, orgType: 'contractor' | 'corporation',
                 status: 'approved' | 'suspended' | 'rejected') =>
    apiFetch<{ id: string; status: string }>(
      `/admin/orgs/${id}/status?org_type=${orgType}`,
      { method: 'PATCH', body: JSON.stringify({ status }) }
    ),

  // ── Leads (callback queue) ──────────────────────────────────────────────
  listLeads: (handled: 'true' | 'false' | 'all' = 'false') =>
    apiFetch<Lead[]>(`/admin/leads?handled=${handled}`),
  markLeadHandled: (id: string) =>
    apiFetch<void>(`/admin/leads/${id}/handled`, { method: 'PATCH' }),
  reopenLead: (id: string) =>
    apiFetch<void>(`/admin/leads/${id}/reopen`, { method: 'PATCH' }),
  deleteLead: (id: string) =>
    apiFetch<void>(`/admin/leads/${id}`, { method: 'DELETE' }),

  // ── Refund request (called from corp billing page) ──────────────────────
  requestRefund: (deal_id: string, reason: string) =>
    apiFetch<{ ok: boolean; duplicate: boolean }>('/admin/refund-requests', {
      method: 'POST',
      body: JSON.stringify({ deal_id, reason }),
    }),

  // ── Platform-wide commission rate (single ₪/worker setting) ─────────────

  getPlatformCommissionRate: () =>
    apiFetch<{ commission_per_worker_nis: number | null; updated_at: string | null; updated_by_user_id: string | null }>(
      '/admin/settings/commission-rate'
    ),

  setPlatformCommissionRate: (commission_per_worker_nis: number) =>
    apiFetch<{ commission_per_worker_nis: number }>('/admin/settings/commission-rate', {
      method: 'PATCH',
      body: JSON.stringify({ commission_per_worker_nis }),
    }),

};
