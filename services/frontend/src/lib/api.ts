const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api';

function getToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.cookie
    .split('; ')
    .find((r) => r.startsWith('access_token='))
    ?.split('=')[1];
}

function getRefreshToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.cookie
    .split('; ')
    .find((r) => r.startsWith('refresh_token='))
    ?.split('=')[1];
}

/** Attempt a silent token refresh. Returns new access token on success, null on failure. */
async function tryRefresh(): Promise<string | null> {
  const refresh = getRefreshToken();
  if (!refresh) return null;
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { access_token: string; refresh_token?: string };
    const { saveTokens } = await import('./auth');
    saveTokens(data.access_token, data.refresh_token ?? refresh);
    return data.access_token;
  } catch {
    return null;
  }
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
    // Try silent refresh before giving up
    const newToken = await tryRefresh();
    if (newToken) {
      const retryHeaders: HeadersInit = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${newToken}`,
        ...(options.headers as Record<string, string> | undefined),
      };
      const retry = await fetch(`${BASE}${path}`, { ...options, headers: retryHeaders });
      if (retry.status !== 401) {
        if (!retry.ok) {
          const err = await retry.json().catch(() => ({ error: retry.statusText }));
          throw new Error((err as { error?: string }).error ?? retry.statusText);
        }
        if (retry.status === 204) return undefined as T;
        return retry.json() as Promise<T>;
      }
    }
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
  getCorporation: (id: string) =>
    apiFetch<import('@/types').Corporation>(`/organizations/corporations/${id}`),
};

export const jobApi = {
  list: () => apiFetch<import('@/types').JobRequest[]>('/job-requests'),
  get: (id: string) => apiFetch<import('@/types').JobRequest>(`/job-requests/${id}`),
  create: (data: unknown) =>
    apiFetch<import('@/types').JobRequest>('/job-requests', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: unknown) =>
    apiFetch<{ id: string }>(`/job-requests/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  replaceLineItems: (id: string, lineItems: unknown[]) =>
    apiFetch<{ id: string; line_items_count: number }>(`/job-requests/${id}/line-items`, {
      method: 'PUT',
      body: JSON.stringify({ line_items: lineItems }),
    }),
  addLineItem: (id: string, lineItem: unknown) =>
    apiFetch<{ id: string }>(`/job-requests/${id}/line-items`, {
      method: 'POST',
      body: JSON.stringify(lineItem),
    }),
  match: async (id: string): Promise<import('@/types').MatchBundle[]> => {
    const res = await apiFetch<{ bundles: import('@/types').MatchBundle[] }>(`/job-requests/${id}/match`, { method: 'POST' });
    const bundles = res.bundles ?? [];
    // Resolve corporation names + threshold_requirements in parallel (best-effort)
    await Promise.allSettled(
      bundles.map(async (b) => {
        try {
          const corp = await orgApi.getCorporation(b.corporation_id);
          b.corporation_name = corp.company_name_he || corp.company_name;
          b.threshold_requirements = corp.threshold_requirements ?? null;
        } catch {
          b.corporation_name = b.corporation_id;
        }
      })
    );
    return bundles;
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

// ─── Team members ─────────────────────────────────────────────────────────────

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

// ─── Documents ────────────────────────────────────────────────────────────────

export interface OrgDocument {
  doc_id: string;
  doc_type: string;
  file_name: string;
  file_url: string;
  file_size: number | null;
  mime_type: string | null;
  is_valid: boolean | null;
  notes: string | null;
  uploaded_at: string;
  validated_at: string | null;
}

export const DOC_TYPE_LABELS: Record<string, string> = {
  registration_cert:        'תעודת רישום',
  contractor_license:       'רישיון קבלן',
  foreign_worker_license:   'רישיון עובדים זרים',
  id_copy:                  'צילום תעודת זהות',
  standard_contract:        'חוזה התקשרות סטנדרטי',
  other:                    'אחר',
};

export const documentApi = {
  list: (orgType: 'contractors' | 'corporations', orgId: string) =>
    apiFetch<OrgDocument[]>(`/organizations/${orgType}/${orgId}/documents`),

  create: (
    orgType: 'contractors' | 'corporations',
    orgId: string,
    data: { doc_type: string; file_url: string; file_name: string; notes?: string }
  ) =>
    apiFetch<{ doc_id: string; doc_type: string; file_name: string }>(
      `/organizations/${orgType}/${orgId}/documents`,
      { method: 'POST', body: JSON.stringify(data) }
    ),

  /** Upload an actual file (multipart). Returns doc record with file_url. */
  upload: async (
    orgType: 'contractors' | 'corporations',
    orgId: string,
    file: File,
    docType: string,
    notes?: string
  ): Promise<{ doc_id: string; doc_type: string; file_name: string; file_url: string }> => {
    const token = typeof document !== 'undefined'
      ? document.cookie.split('; ').find((r) => r.startsWith('access_token='))?.split('=')[1]
      : undefined;
    const form = new FormData();
    form.append('file', file);
    form.append('doc_type', docType);
    if (notes) form.append('notes', notes);
    const res = await fetch(`${BASE}/organizations/${orgType}/${orgId}/documents/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err as { error?: string; detail?: string }).error ?? (err as { detail?: string }).detail ?? res.statusText);
    }
    return res.json();
  },

  delete: (orgType: 'contractors' | 'corporations', orgId: string, docId: string) =>
    apiFetch<void>(`/organizations/${orgType}/${orgId}/documents/${docId}`, { method: 'DELETE' }),
};

// ─── Invite accept ────────────────────────────────────────────────────────────

export interface InviteMetadata {
  entity_type: 'contractor' | 'corporation';
  entity_id: string;
  entity_name: string | null;
  role: string;
  job_title: string | null;
  inviter_name: string | null;
  membership_id: string;
}

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

export const paymentApi = {
  /** List payment methods for the authenticated entity (from JWT context). */
  methods: () =>
    apiFetch<import('@/types').PaymentMethod[]>('/payments/payment-methods'),

  /** Delete (soft) a payment method. */
  deleteMethod: (pmId: string) =>
    apiFetch<void>(`/payments/payment-methods/${pmId}`, { method: 'DELETE' }),

  /** Set a payment method as the default. */
  setDefault: (pmId: string) =>
    apiFetch<{ id: string; is_default: boolean }>(
      `/payments/payment-methods/${pmId}/set-default`,
      { method: 'PATCH' }
    ),

  /** Get a Cardcom LowProfile tokenization URL to redirect the user to. */
  cardcomInit: () =>
    apiFetch<{ url: string; low_profile_id: string }>('/payments/cardcom-init'),

  /** Commit to a deal — creates a pending_charge transaction. */
  commitEngagement: (dealId: string) =>
    apiFetch<import('@/types').CommitEngagementResult>(
      `/payments/deals/${dealId}/commit-engagement`,
      { method: 'POST' }
    ),

  /** Get the current payment transaction status for a deal. */
  dealPaymentStatus: (dealId: string) =>
    apiFetch<{ deal_id: string; payment_status: string | null; total_amount?: number }>(
      `/payments/deals/${dealId}/payment-status`
    ),
};

export const marketplaceApi = {
  list: (params?: {
    category?: string;
    region?: string;
    city?: string;
    min_capacity?: number;
    search?: string;
    mine?: boolean;
  }) => {
    const qs = new URLSearchParams();
    if (params?.category) qs.set('category', params.category);
    if (params?.region) qs.set('region', params.region);
    if (params?.city) qs.set('city', params.city);
    if (params?.min_capacity) qs.set('min_capacity', String(params.min_capacity));
    if (params?.search) qs.set('search', params.search);
    if (params?.mine) qs.set('mine', 'true');
    const query = qs.toString();
    return apiFetch<import('@/types').MarketplaceListing[]>(
      `/marketplace${query ? '?' + query : ''}`
    );
  },

  get: (id: string) =>
    apiFetch<import('@/types').MarketplaceListing>(`/marketplace/${id}`),

  create: (data: {
    category: string;
    title: string;
    description?: string;
    city?: string;
    region?: string;
    price?: number;
    price_unit?: string;
    capacity?: number;
    is_furnished?: boolean;
    available_from?: string;
    contact_phone?: string;
    contact_name?: string;
    subcategory?: string;
  }) =>
    apiFetch<{ id: string; status: string }>('/marketplace', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<{
    title: string;
    description: string;
    city: string;
    region: string;
    price: number;
    price_unit: string;
    capacity: number;
    is_furnished: boolean;
    available_from: string;
    contact_phone: string;
    contact_name: string;
    status: string;
  }>) =>
    apiFetch<{ id: string; updated: boolean }>(`/marketplace/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  remove: (id: string) =>
    apiFetch<void>(`/marketplace/${id}`, { method: 'DELETE' }),
};

export const leadsApi = {
  submit: (data: import('@/types').LeadFormData) =>
    apiFetch<{ id: string; message: string }>('/marketplace/leads', {
      method: 'POST',
      body: JSON.stringify(data),
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
  updateWorkers: (id: string, workerIds: string[]) =>
    apiFetch<{ deal_id: string; assigned: number }>(`/deals/${id}/workers`, {
      method: 'PUT',
      body: JSON.stringify({ worker_ids: workerIds }),
    }),
  updateStatus: (id: string, status: string) =>
    apiFetch<import('@/types').Deal>(`/deals/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
};
