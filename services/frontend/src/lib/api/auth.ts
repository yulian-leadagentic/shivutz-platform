import { apiFetch } from './client';
import type { User } from '@/types';

export interface Membership {
  membership_id: string;
  entity_id: string;
  entity_type: 'contractor' | 'corporation';
  /** Hebrew company name (or fallback to non-Hebrew name). May be null
   *  for legacy memberships where the org row was deleted but the
   *  membership row lingered — display logic should fall back to the
   *  entity_type label in that case. */
  entity_name: string | null;
  role: string;
}

export interface InviteMetadata {
  entity_type: 'contractor' | 'corporation';
  entity_id: string;
  entity_name: string | null;
  role: string;
  job_title: string | null;
  inviter_name: string | null;
  membership_id: string;
  /** Pre-fill values for the accept screen. NULL on legacy rows that
   *  predate the invited_phone / invited_*_name columns — UI falls back
   *  to free input in that case. */
  invited_phone:      string | null;
  invited_first_name: string | null;
  invited_last_name:  string | null;
}

export const authApi = {
  login: (email: string, password: string) =>
    apiFetch<{ access_token: string; refresh_token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (data: { email: string; password: string; role: string }) =>
    apiFetch<{ id: string; email: string; role: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  me: () => apiFetch<User>('/auth/me'),
};

export const otpApi = {
  /** Send a 6-digit OTP to phone. Purpose: 'login' | 'register' | 'invite_accept'. */
  sendOtp: (phone: string, purpose: 'login' | 'register' | 'invite_accept') =>
    apiFetch<{ sent: boolean; phone: string }>('/auth/send-otp', {
      method: 'POST',
      body: JSON.stringify({ phone, purpose }),
    }),

  /** Verify OTP without issuing a JWT (used during registration to confirm phone ownership). */
  verifyOtp: (phone: string, code: string, purpose: string) =>
    apiFetch<{ valid: boolean; phone: string }>('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ phone, code, purpose }),
    }),

  /** Full login: verify OTP + issue JWT. Returns entity context or
   *  needs_entity_selection on the registered-user path. When the
   *  phone has NO user record, returns `{ prospect: true, phone, intent }`
   *  instead — no JWT issued, but the backend has marked the OTP as
   *  satisfying the 'register' purpose for the next 15 minutes so the
   *  caller can drop the user into the trial → register flow without a
   *  second OTP. The `intent` param lets us route them to the right
   *  trial surface (today: contractor only). */
  loginOtp: (phone: string, code: string, intent?: 'contractor' | 'corporation') =>
    apiFetch<
      | {
          prospect?: undefined;
          access_token: string;
          refresh_token: string;
          role: string;
          needs_entity_selection: boolean;
          memberships?: Membership[];
        }
      | {
          prospect: true;
          phone: string;
          intent: 'contractor' | 'corporation';
        }
    >('/auth/login/otp', {
      method: 'POST',
      body: JSON.stringify({ phone, code, intent }),
    }),

  /** Re-issue JWT scoped to a specific entity (called after needs_entity_selection=true). */
  selectEntity: (entityId: string, entityType: string) =>
    apiFetch<{ access_token: string; refresh_token: string }>('/auth/select-entity', {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId, entity_type: entityType }),
    }),

  /**
   * List the *current* user's active memberships. Used by the
   * landing-page tile click handler to switch entity context
   * cross-role (e.g. logged-in contractor clicks the corporation
   * tile and we hot-swap their JWT to the corporation membership
   * without re-authenticating).
   */
  myMemberships: () =>
    apiFetch<{ memberships: Membership[] }>('/auth/memberships'),
};

export const inviteApi = {
  validate: (token: string) =>
    apiFetch<InviteMetadata>('/auth/invite/validate', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  /** Accept the invitation. `phone` must match the invited_phone the
   *  inviter typed (server enforces hard match). `fullName` is only
   *  used as a fallback for legacy rows where invited_first/last_name
   *  weren't captured — modern invites ignore it entirely. */
  accept: (token: string, phone: string, code: string, fullName?: string) =>
    apiFetch<{ access_token: string; refresh_token: string; role: string }>(
      '/auth/invite/accept',
      {
        method: 'POST',
        body: JSON.stringify({ token, phone, code, full_name: fullName }),
      }
    ),
};
