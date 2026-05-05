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
  /** Full name from auth_db.users (when accepted) — backend falls back
   *  to "{invited_first_name} {invited_last_name}" for pending rows so
   *  the team UI can render a name immediately. */
  full_name: string | null;
  email: string | null;
  pending: boolean;
  invited_first_name?: string | null;
  invited_last_name?:  string | null;
}

export interface InvitePayload {
  phone:       string;
  role:        string;
  jobTitle?:   string;
  firstName?:  string;
  lastName?:   string;
}

export const memberApi = {
  list: (orgType: 'contractors' | 'corporations', orgId: string) =>
    apiFetch<TeamMember[]>(`/organizations/${orgType}/${orgId}/users`),

  invite: (orgType: 'contractors' | 'corporations', orgId: string, payload: InvitePayload) =>
    apiFetch<{ membership_id: string; role: string; pending: boolean }>(
      `/organizations/${orgType}/${orgId}/users`,
      {
        method: 'POST',
        body: JSON.stringify({
          phone:      payload.phone,
          role:       payload.role,
          job_title:  payload.jobTitle,
          first_name: payload.firstName,
          last_name:  payload.lastName,
        }),
      }
    ),
};
