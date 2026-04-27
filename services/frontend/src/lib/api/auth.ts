import { apiFetch } from './client';
import type { User } from '@/types';

export interface Membership {
  membership_id: string;
  entity_id: string;
  entity_type: 'contractor' | 'corporation';
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

  /** Full login: verify OTP + issue JWT. Returns entity context or needs_entity_selection. */
  loginOtp: (phone: string, code: string) =>
    apiFetch<{
      access_token: string;
      refresh_token: string;
      role: string;
      needs_entity_selection: boolean;
      memberships?: Membership[];
    }>('/auth/login/otp', {
      method: 'POST',
      body: JSON.stringify({ phone, code }),
    }),

  /** Re-issue JWT scoped to a specific entity (called after needs_entity_selection=true). */
  selectEntity: (entityId: string, entityType: string) =>
    apiFetch<{ access_token: string; refresh_token: string }>('/auth/select-entity', {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId, entity_type: entityType }),
    }),
};

export const inviteApi = {
  validate: (token: string) =>
    apiFetch<InviteMetadata>('/auth/invite/validate', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  accept: (token: string, phone: string, code: string, fullName?: string) =>
    apiFetch<{ access_token: string; refresh_token: string; role: string }>(
      '/auth/invite/accept',
      {
        method: 'POST',
        body: JSON.stringify({ token, phone, code, full_name: fullName }),
      }
    ),
};
