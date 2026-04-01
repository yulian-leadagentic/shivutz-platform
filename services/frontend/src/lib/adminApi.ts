import { apiFetch } from './api';
import type { Deal } from '@/types';

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
};
