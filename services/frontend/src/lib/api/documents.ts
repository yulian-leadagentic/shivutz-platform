import { BASE, apiFetch } from './client';

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
