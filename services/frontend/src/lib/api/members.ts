import { apiFetch } from './client';

export interface TeamMember {
  membership_id: string;
  user_id: string | null;
  role: string;
  job_title: string | null;
  is_active: boolean;
  invitation_accepted_at: string | null;
  created_at: string;
  phone: string | null;
  full_name: string | null;
  email: string | null;
  pending: boolean;
}

export const memberApi = {
  list: (orgType: 'contractors' | 'corporations', orgId: string) =>
    apiFetch<TeamMember[]>(`/organizations/${orgType}/${orgId}/users`),

  invite: (orgType: 'contractors' | 'corporations', orgId: string, phone: string, role: string, jobTitle?: string) =>
    apiFetch<{ membership_id: string; role: string; pending: boolean }>(
      `/organizations/${orgType}/${orgId}/users`,
      {
        method: 'POST',
        body: JSON.stringify({ phone, role, job_title: jobTitle }),
      }
    ),
};
