import { apiFetch } from './client';

export interface TeamMember {
  membership_id: string;
  user_id: string | null;
  role: string;
  job_title: string | null;
  is_active: boolean;
  /** When TRUE this member is exposed to the other party on approved
   *  deals as a contact point (name + phone + email tap-to-call).
   *  At least one active member per entity must carry the flag —
   *  enforced server-side. Backend defaults the founder to true via
   *  migration 048; UI on /corporation/users + /contractor/users
   *  toggles it per-row.
   *  Optional in the type so optimistically-constructed pending rows
   *  (newly-invited members in the corp users page) don't need to
   *  guess a default — the backend will return the true value on the
   *  next list refetch. */
  is_deal_contact?: boolean;
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

  /** Hard-delete a membership (active or pending). Also cleans up the
   *  notification_recipients row for the same (entity, user) pair.
   *  Server returns 204 No Content; sole-owner protection returns 409. */
  remove: (orgType: 'contractors' | 'corporations', orgId: string, membershipId: string) =>
    apiFetch<void>(
      `/organizations/${orgType}/${orgId}/users/${membershipId}`,
      { method: 'DELETE' },
    ),

  /** Patch a membership in place.
   *
   *  Active rows (already accepted): only `role` + `job_title` are honored.
   *  Pending rows: also accepts `invited_first_name`, `invited_last_name`,
   *  `invited_phone`. Changing `invited_phone` triggers a fresh SMS to
   *  the new number using the same invitation_token.
   *
   *  Returns the updated member row (same shape as the list endpoint)
   *  so the caller can replace it without a full refetch.
   *
   *  409 = sole-owner demotion attempt. */
  update: (
    orgType: 'contractors' | 'corporations',
    orgId: string,
    membershipId: string,
    patch: Partial<{
      role: string;
      job_title: string | null;
      invited_first_name: string | null;
      invited_last_name:  string | null;
      invited_phone:      string;
      // Email — for active members updates auth_db.users.email, for
      // pending invites stages on entity_memberships.invited_email.
      // Empty string clears; omit to leave unchanged. 409 with
      // code='email_already_in_use' on UNIQUE collision.
      email:              string;
    }>,
  ) =>
    apiFetch<TeamMember>(
      `/organizations/${orgType}/${orgId}/users/${membershipId}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    ),

  /** Toggle whether a member is exposed as a deal contact for the
   *  other party. Server enforces min-1: unmarking the last remaining
   *  contact returns 409 with code='need_at_least_one_contact'. */
  setDealContact: (
    orgType: 'contractors' | 'corporations',
    orgId: string,
    membershipId: string,
    isDealContact: boolean,
  ) =>
    apiFetch<{ membership_id: string; is_deal_contact: boolean }>(
      `/organizations/${orgType}/${orgId}/users/${membershipId}/deal-contact`,
      { method: 'PATCH', body: JSON.stringify({ is_deal_contact: isDealContact }) },
    ),

  /** List active deal contacts for an entity — used by the deal pages
   *  to render "who at the other party to call". Backend filters out
   *  pending invites + inactive members. */
  listDealContacts: (orgType: 'contractors' | 'corporations', orgId: string) =>
    apiFetch<Array<{
      membership_id: string;
      full_name: string | null;
      phone: string | null;
      email: string | null;
      job_title: string | null;
    }>>(
      `/organizations/${orgType}/${orgId}/deal-contacts`,
    ),
};
