import { apiFetch } from './api';
import { BASE } from './api/client';
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

/** Row returned by GET /admin/deals — the listing endpoint. Lighter
 *  than `AdminDealDetail` (no reports, commission, or full worker
 *  list) but carries party contacts + stuck-stage so the admin can
 *  scan the table without clicking through. */
export interface AdminDealRow extends Deal {
  contractor_name:    string | null;
  corporation_name:   string | null;
  contractor_contact: { name: string | null; phone: string | null; email: string | null } | null;
  corporation_contact: { name: string | null; phone: string | null; email: string | null } | null;
  profession_type?:   string | null;
  profession_he?:     string | null;
  region?:            string | null;
  // `requested_count` was already on Deal as `number | undefined`;
  // can't tighten OR widen it incompatibly here. Backend returns
  // null on rows whose worker_search row got pruned, so callers
  // already need to defensively coalesce — same shape as Deal.
  requested_count?:   number;
  worker_count?:      number;
  /** Which party is currently blocking the deal from moving forward.
   *  Drives the dashboard's filter chips + the "stuck on X" label
   *  on each row. */
  stuck_on:           'corp' | 'contractor' | 'system' | 'admin' | 'neither' | 'unknown';
  /** Hours the deal has been in its current stage. Drives the
   *  "stuck for Xh" hint + colour escalation as it grows. */
  hours_in_stage:     number | null;
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

  // Read-only count of deals still in `proposed` state past the
  // corp-response deadline (default 48h). Drives the admin
  // dashboard's "X bids overdue" banner. The endpoint lives on
  // the deal service under /internal/ — no auth check, no
  // dependency on the cron, just a cheap COUNT(*).
  corpResponseOverdueCount: () =>
    apiFetch<{ count: number; hours: number }>('/deals/internal/corp-response-overdue/count'),

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

  /** @deprecated — calls the role-scoped deal service /deals list,
   *  which doesn't carry party names. Use `allDealsForAdmin()`
   *  below for the dashboard, that hits the admin service's
   *  /admin/deals endpoint with full party enrichment. */
  allDeals: () => apiFetch<Deal[]>('/deals'),

  /**
   * Every deal in the system, enriched for the admin dashboard:
   *  - contractor_name + contractor_contact (name/phone/email)
   *  - corporation_name + corporation_contact
   *  - profession_he, region, requested_count from the search row
   *  - stuck_on: 'corp' | 'contractor' | 'system' | 'admin' | 'neither'
   *  - hours_in_stage: how long the deal has been in its current
   *    stage (drives the "stuck for X hours" hint)
   *
   * `stuck` and `status` filters are server-side (we ship the
   * narrowed list to the browser, not the full 65-row dump). The
   * frontend can also sort/filter further client-side once loaded.
   */
  allDealsForAdmin: (params?: { stuck?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.stuck)  qs.set('stuck',  params.stuck);
    if (params?.status) qs.set('status', params.status);
    const tail = qs.toString();
    return apiFetch<{ items: AdminDealRow[]; total: number }>(
      `/admin/deals${tail ? `?${tail}` : ''}`,
    );
  },

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

  // ── Customer-service inbox (QA-R3 #24) ──────────────────────────────────
  listSupportTickets: (status?: 'open' | 'in_progress' | 'resolved') =>
    apiFetch<Array<{
      id: string;
      entity_type: 'contractor' | 'corporation' | 'admin' | null;
      entity_id: string | null;
      user_id: string | null;
      subject: string;
      body: string;
      contact_phone: string | null;
      status: 'open' | 'in_progress' | 'resolved';
      created_at: string;
      handled_at: string | null;
      handled_by_user_id: string | null;
      admin_notes: string | null;
      // Enrichment from join (best-effort, may be missing for legacy rows)
      org_name?: string | null;
      org_phone?: string | null;
      org_email?: string | null;
      user_phone?: string | null;
      user_name?: string | null;
    }>>(`/admin/support-tickets${status ? `?status=${status}` : ''}`),
  updateSupportTicket: (id: string, data: { status?: 'open' | 'in_progress' | 'resolved'; admin_notes?: string }) =>
    apiFetch<{ id: string }>(`/admin/support-tickets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // ── Country (origin) CRUD — QA-R3 #19b ──────────────────────────────────
  // Read endpoint returns ALL countries (active + inactive) so the admin
  // can toggle disabled rows back on. Public picker uses /api/enums/origins
  // which filters to is_active=1.

  listAllOrigins: () =>
    apiFetch<Array<{ code: string; name_he: string; name_en: string; is_active: number | boolean }>>(
      '/admin/enums/origins'
    ),
  addOrigin: (data: { code: string; name_he: string; name_en: string }) =>
    apiFetch<{ code: string }>('/admin/enums/origins', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateOrigin: (code: string, data: { name_he?: string; name_en?: string; is_active?: boolean }) =>
    apiFetch<{ code: string; updated_fields: string[] }>(`/admin/enums/origins/${code}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deactivateOrigin: (code: string) =>
    apiFetch<void>(`/admin/enums/origins/${code}`, { method: 'DELETE' }),

  // ── רשות האוכלוסין annual manpower-corps PDF ─────────────────────
  /** List years that have data in the registry, with row counts +
   *  last imported_at. Drives the "current data" panel on the admin
   *  upload page. */
  listGovCorpYears: () =>
    apiFetch<{ years: Array<{
      source_year: number;
      row_count: number;
      matchable_count: number;
      last_imported_at: string;
    }> }>('/admin/gov-corps-registry/years'),

  /** Preview every parsed row for a given year — for spot-checking
   *  the import. */
  previewGovCorpsYear: (year: number) =>
    apiFetch<{ year: number; rows: Array<Record<string, unknown>> }>(
      `/admin/gov-corps-registry/${year}`,
    ),

  /** Upload the gov PDF + year. Backend parses, replaces all rows for
   *  that year, and re-promotes existing corps whose ח.פ is in the
   *  file to tier_2 with verification_method='gov_list_match'.
   *
   *  We import BASE here and don't use apiFetch — apiFetch hard-codes
   *  Content-Type: application/json which breaks multipart uploads.
   *  Using a raw fetch but pinned to BASE so we hit the gateway origin
   *  (apiFetch resolves `${BASE}${path}`), not the frontend origin —
   *  hitting the frontend's relative URL is what produces the
   *  'Failed to fetch' browser error. */
  importGovCorpsPdf: async (year: number, file: File) => {
    const fd = new FormData();
    fd.append('source_year', String(year));
    fd.append('file', file);
    const token = (typeof window !== 'undefined') ? window.localStorage.getItem('access_token') : null;
    const res = await fetch(`${BASE}/admin/gov-corps-registry/import`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `upload_failed: ${res.status}`);
    }
    return res.json() as Promise<{
      ok: true;
      source_year: number;
      rows_parsed: number;
      rows_with_business_number: number;
      rows_skipped_no_business_number: number;
      rows_inserted: number;
      existing_corps_promoted_or_renewed: number;
    }>;
  },

};
