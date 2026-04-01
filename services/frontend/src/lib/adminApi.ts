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
}

export interface AdminDashboard {
  pending_approvals: number;
  pending_contractors: number;
  pending_corporations: number;
  open_job_requests: number;
  active_deals: number;
  discrepancy_alerts: number;
  completed_deals: number;
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

  decide: (id: string, orgType: string, approved: boolean, reason?: string) =>
    apiFetch<{ id: string; status: string; company_name: string }>(
      `/admin/approvals/${id}?org_type=${orgType}`,
      { method: 'PATCH', body: JSON.stringify({ approved, reason: reason || null }) }
    ),

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
};
