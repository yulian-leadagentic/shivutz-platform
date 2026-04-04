const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api';

function getToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.cookie
    .split('; ')
    .find((r) => r.startsWith('access_token='))
    ?.split('=')[1];
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (res.status === 401 && typeof window !== 'undefined') {
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
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
  me: () => apiFetch<import('@/types').User>('/auth/me'),
};

export const enumApi = {
  professions: () => apiFetch<import('@/types').Profession[]>('/enums/professions'),
  regions: () =>
    apiFetch<{ code: string; name_he: string; name_en: string }[]>('/enums/regions'),
  origins: () =>
    apiFetch<{ code: string; name_he: string; name_en: string }[]>('/enums/origins'),
};

export const orgApi = {
  registerContractor: (data: unknown) =>
    apiFetch('/organizations/contractors', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  registerCorporation: (data: unknown) =>
    apiFetch('/organizations/corporations', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getContractor: (id: string) =>
    apiFetch<import('@/types').Contractor>(`/organizations/contractors/${id}`),
};

export const jobApi = {
  list: () => apiFetch<import('@/types').JobRequest[]>('/job-requests'),
  get: (id: string) => apiFetch<import('@/types').JobRequest>(`/job-requests/${id}`),
  create: (data: unknown) =>
    apiFetch<import('@/types').JobRequest>('/job-requests', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  match: async (id: string): Promise<import('@/types').MatchBundle[]> => {
    const res = await apiFetch<{ bundles: import('@/types').MatchBundle[] }>(`/job-requests/${id}/match`, { method: 'POST' });
    return res.bundles ?? [];
  },
};

export const workerApi = {
  list: (corporationId?: string) => {
    const qs = corporationId ? `?corporation_id=${corporationId}` : '';
    return apiFetch<import('@/types').Worker[]>(`/workers${qs}`);
  },
  get: (id: string) => apiFetch<import('@/types').Worker>(`/workers/${id}`),
  create: (data: unknown) =>
    apiFetch<import('@/types').Worker>('/workers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: unknown) =>
    apiFetch<import('@/types').Worker>(`/workers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    apiFetch<void>(`/workers/${id}`, { method: 'DELETE' }),
  bulkCreate: (data: unknown) =>
    apiFetch<{ created: number; ids: string[] }>('/workers/bulk', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// ─── OTP / phone-auth ─────────────────────────────────────────────────────────

export interface Membership {
  membership_id: string;
  entity_id: string;
  entity_type: 'contractor' | 'corporation';
  role: string;
}

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

export const dealApi = {
  list: () => apiFetch<import('@/types').Deal[]>('/deals'),
  get: (id: string) => apiFetch<import('@/types').Deal>(`/deals/${id}`),
  create: (data: unknown) =>
    apiFetch<import('@/types').Deal>('/deals', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  messages: (id: string) =>
    apiFetch<import('@/types').Message[]>(`/deals/${id}/messages`),
  sendMsg: (id: string, content: string) =>
    apiFetch<import('@/types').Message>(`/deals/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  report: (id: string, data: unknown) =>
    apiFetch(`/deals/${id}/report`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  workers: (id: string) =>
    apiFetch<import('@/types').Worker[]>(`/deals/${id}/workers`),
  updateStatus: (id: string, status: string) =>
    apiFetch<import('@/types').Deal>(`/deals/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
};
