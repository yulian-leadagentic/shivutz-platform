'use client';

import { Suspense, useEffect, useState, FormEvent, useCallback } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight, Loader2, Save, ShieldCheck, ShieldAlert, History as HistoryIcon,
  Upload, Building2, AlertCircle,
} from 'lucide-react';
import { adminApi, type OrgEditPayload, type OrgAuditEntry } from '@/lib/adminApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type OrgType = 'contractor' | 'corporation';

// Loose row type — admin-only endpoint returns the full row.
type OrgRow = {
  id: string;
  org_type: OrgType;
  company_name: string | null;
  company_name_he: string | null;
  business_number: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  approval_status: string | null;
  commission_per_worker_amount: number | null;
  // Contractor-only registry fields
  kablan_number?: string | null;
  kvutza?: string | null;
  sivug?: number | null;
  gov_branch?: string | null;
  gov_company_status?: string | null;
  verification_tier?: string | null;
  verification_method?: string | null;
  // Corp-only
  countries_of_origin?: string[] | string | null;
  minimum_contract_months?: number | null;
  tc_signed_at?: string | null;
  tc_version?: string | null;
  created_at?: string;
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('he-IL');
}

function StatusBadgeRow({ status }: { status: string | null }) {
  const map: Record<string, { label: string; cls: string }> = {
    approved:  { label: 'מאושר',  cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    pending:   { label: 'ממתין',  cls: 'bg-amber-100 text-amber-700 border-amber-200' },
    rejected:  { label: 'נדחה',   cls: 'bg-red-100 text-red-700 border-red-200' },
    suspended: { label: 'מושהה',  cls: 'bg-slate-200 text-slate-700 border-slate-300' },
  };
  const s = map[status || 'pending'] || map.pending;
  return <span className={`text-xs font-medium px-2 py-0.5 rounded border ${s.cls}`}>{s.label}</span>;
}

function OrgDetailContent() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sp     = useSearchParams();
  const id     = params.id;
  const orgType = (sp.get('type') === 'corporation' ? 'corporation' : 'contractor') as OrgType;

  const [org, setOrg]         = useState<OrgRow | null>(null);
  const [form, setForm]       = useState<OrgEditPayload>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [error, setError]     = useState('');
  const [toast, setToast]     = useState('');
  const [history, setHistory] = useState<OrgAuditEntry[] | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    adminApi.getOrg(id, orgType)
      .then((r) => {
        const row = r as unknown as OrgRow;
        // countries_of_origin can be a JSON string or a plain array — normalise.
        let coo = row.countries_of_origin;
        if (typeof coo === 'string') {
          try { coo = JSON.parse(coo); } catch { coo = []; }
        }
        setOrg({ ...row, countries_of_origin: Array.isArray(coo) ? coo : [] });
        setForm({
          company_name_he: row.company_name_he ?? '',
          company_name:    row.company_name    ?? '',
          contact_name:    row.contact_name    ?? '',
          contact_email:   row.contact_email   ?? '',
          contact_phone:   row.contact_phone   ?? '',
          notes:           row.notes           ?? '',
          commission_per_worker_amount: row.commission_per_worker_amount ?? 500,
          business_number:    row.business_number ?? '',
          gov_company_status: row.gov_company_status ?? '',
          kablan_number:      row.kablan_number ?? '',
          kvutza:             row.kvutza ?? '',
          sivug:              row.sivug ?? undefined,
          gov_branch:         row.gov_branch ?? '',
          countries_of_origin: Array.isArray(coo) ? (coo as string[]) : [],
          minimum_contract_months: row.minimum_contract_months ?? undefined,
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'שגיאה'))
      .finally(() => setLoading(false));
  }, [id, orgType]);

  useEffect(() => { load(); }, [load]);

  function pushToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 4000); }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await adminApi.editOrg(id, orgType, form);
      pushToast('✓ הפרטים עודכנו');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בעדכון');
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(status: 'approved' | 'suspended') {
    if (status === 'suspended' && !confirm('להשהות את הארגון? לא יוכל להגיש פניות / לפרסם עובדים.')) return;
    setStatusBusy(true);
    try {
      await adminApi.setOrgStatus(id, orgType, status);
      pushToast(status === 'suspended' ? '✓ הארגון הושהה' : '✓ הארגון הופעל מחדש');
      load();
    } catch (err) {
      pushToast(`✗ ${err instanceof Error ? err.message : 'שגיאה'}`);
    } finally {
      setStatusBusy(false);
    }
  }

  async function loadHistory() {
    try {
      const rows = await adminApi.orgAudit(id, orgType);
      setHistory(rows);
    } catch (err) {
      pushToast(`✗ ${err instanceof Error ? err.message : 'שגיאה'}`);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      await adminApi.uploadOrgDocument(orgType, id, f);
      pushToast(`✓ ${f.name} הועלה`);
    } catch (err) {
      pushToast(`✗ ${err instanceof Error ? err.message : 'שגיאת העלאה'}`);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (error || !org) {
    return (
      <Card>
        <CardContent className="p-6 text-red-600">{error || 'הארגון לא נמצא'}</CardContent>
      </Card>
    );
  }

  const isSuspended = org.approval_status === 'suspended';
  const isApproved  = org.approval_status === 'approved';

  return (
    <div className="max-w-4xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push('/admin/orgs')}>
            <ArrowRight className="h-4 w-4" /> חזרה
          </Button>
          <Building2 className="h-6 w-6 text-brand-600" />
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              {org.company_name_he || org.company_name || '—'}
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge variant={orgType === 'contractor' ? 'default' : 'secondary'}>
                {orgType === 'contractor' ? 'קבלן' : 'תאגיד'}
              </Badge>
              <StatusBadgeRow status={org.approval_status} />
              {org.verification_tier && (
                <span className="text-xs text-slate-500">tier: <code dir="ltr">{org.verification_tier}</code></span>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isApproved && (
            <Button variant="outline" size="sm" onClick={() => setStatus('suspended')} disabled={statusBusy}>
              <ShieldAlert className="h-3.5 w-3.5" /> השהה
            </Button>
          )}
          {isSuspended && (
            <Button variant="outline" size="sm" onClick={() => setStatus('approved')} disabled={statusBusy}>
              <ShieldCheck className="h-3.5 w-3.5" /> הפעל מחדש
            </Button>
          )}
          <label className="inline-flex">
            <input type="file" hidden onChange={handleFile} />
            <span className={`inline-flex items-center gap-1 cursor-pointer px-3 py-1.5 rounded-md border border-slate-300 text-sm hover:bg-slate-50 ${uploading ? 'opacity-50' : ''}`}>
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              העלה מסמך
            </span>
          </label>
          <Button variant="outline" size="sm" onClick={loadHistory}>
            <HistoryIcon className="h-3.5 w-3.5" /> היסטוריה
          </Button>
        </div>
      </div>

      {/* Edit form */}
      <Card>
        <CardHeader><CardTitle className="text-base">פרטי הארגון</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={save} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">שם החברה (עברית)</label>
              <input value={form.company_name_he ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, company_name_he: e.target.value }))}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">שם החברה (אנגלית)</label>
              <input value={form.company_name ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, company_name: e.target.value }))}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">איש קשר</label>
              <input value={form.contact_name ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, contact_name: e.target.value }))}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">אימייל</label>
              <input value={form.contact_email ?? ''} dir="ltr"
                onChange={(e) => setForm((p) => ({ ...p, contact_email: e.target.value }))}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">טלפון</label>
              <input value={form.contact_phone ?? ''} dir="ltr"
                onChange={(e) => setForm((p) => ({ ...p, contact_phone: e.target.value }))}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">עמלת פלטפורמה לעובד (₪)</label>
              <input type="number" step="0.01" min="0" dir="ltr"
                value={form.commission_per_worker_amount ?? 0}
                onChange={(e) => setForm((p) => ({ ...p, commission_per_worker_amount: parseFloat(e.target.value) }))}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-slate-500 block mb-1">הערות</label>
              <textarea rows={2} value={form.notes ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" />
            </div>

            {/* Editable registry / business fields ─────────────────────── */}
            <div className="sm:col-span-2 mt-2 pt-3 border-t border-slate-100">
              <p className="text-xs font-semibold text-slate-600 mb-2">פרטי רישום</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">ח.פ / ע.מ</label>
                  <input value={form.business_number ?? ''} dir="ltr" maxLength={9}
                    onChange={(e) => setForm((p) => ({ ...p, business_number: e.target.value.replace(/\D/g, '') }))}
                    className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">סטטוס רשם החברות</label>
                  <input value={form.gov_company_status ?? ''}
                    onChange={(e) => setForm((p) => ({ ...p, gov_company_status: e.target.value }))}
                    placeholder="פעילה / מחוקה / ..."
                    className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" />
                </div>

                {orgType === 'contractor' && (
                  <>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">מספר קבלן</label>
                      <input value={form.kablan_number ?? ''} dir="ltr"
                        onChange={(e) => setForm((p) => ({ ...p, kablan_number: e.target.value }))}
                        className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">סיווג</label>
                      <select
                        value={form.kvutza && form.sivug ? `${form.kvutza}${form.sivug}` : ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!v) {
                            setForm((p) => ({ ...p, kvutza: undefined, sivug: undefined }));
                          } else {
                            // Combined value like "ג3" — first char is kvutza, rest is sivug.
                            const k = v.charAt(0);
                            const s = parseInt(v.slice(1), 10);
                            setForm((p) => ({ ...p, kvutza: k, sivug: s }));
                          }
                        }}
                        className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm">
                        <option value="">—</option>
                        {(['ג','ב','א','ד','ה'] as const).flatMap((k) =>
                          [1,2,3,4,5].map((n) => (
                            <option key={`${k}${n}`} value={`${k}${n}`}>{`${k}${n}`}</option>
                          ))
                        )}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">ענף</label>
                      <input value={form.gov_branch ?? ''}
                        onChange={(e) => setForm((p) => ({ ...p, gov_branch: e.target.value }))}
                        placeholder="בניה / תשתיות / ..."
                        className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" />
                    </div>
                  </>
                )}

                {orgType === 'corporation' && (
                  <>
                    <div className="sm:col-span-2">
                      <label className="text-xs text-slate-500 block mb-1">מדינות מוצא עובדים</label>
                      <input
                        value={(form.countries_of_origin ?? []).join(', ')} dir="ltr"
                        onChange={(e) => {
                          const arr = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                          setForm((p) => ({ ...p, countries_of_origin: arr }));
                        }}
                        placeholder="PH, TH, MD, RO, IN, NP, LK, VN"
                        className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                      />
                      <p className="text-xs text-slate-400 mt-0.5">קודי מדינות מופרדים בפסיקים</p>
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">חוזה מינימום (חודשים)</label>
                      <input type="number" min="1" max="60" dir="ltr"
                        value={form.minimum_contract_months ?? ''}
                        onChange={(e) => setForm((p) => ({ ...p, minimum_contract_months: parseInt(e.target.value) || undefined }))}
                        className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" />
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Audit-only block: timestamps + T&C */}
            <div className="sm:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-100 text-sm">
              <Field label="נרשם"  value={fmtDate(org.created_at)} />
              {orgType === 'corporation' && (
                <Field label="T&C" value={org.tc_signed_at ? `נחתם ${fmtDate(org.tc_signed_at)}` : 'לא נחתם'} />
              )}
            </div>

            {error && (
              <div className="sm:col-span-2 flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                <AlertCircle className="h-4 w-4 mt-0.5" /> {error}
              </div>
            )}
            <div className="sm:col-span-2 flex justify-end gap-2 pt-1">
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                שמור שינויים
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Audit history */}
      {history !== null && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><HistoryIcon className="h-4 w-4" /> היסטוריית שינויים</CardTitle></CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-sm text-slate-400">אין רישומים</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {history.map((h) => (
                  <li key={h.log_id} className="border-b border-slate-100 pb-2 last:border-0">
                    <div className="flex items-center justify-between text-slate-700">
                      <span className="font-medium">{h.action}</span>
                      <span className="text-xs text-slate-400" dir="ltr">{fmtDate(h.created_at)}</span>
                    </div>
                    {h.metadata && (
                      <pre className="mt-1 text-xs text-slate-500 bg-slate-50 rounded p-2 overflow-x-auto" dir="ltr">{JSON.stringify(h.metadata, null, 2)}</pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 start-6 px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white z-50 ${toast.startsWith('✓') ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast}
        </div>
      )}

      <p className="text-center pt-2">
        <Link href="/admin/orgs" className="text-xs text-slate-400 hover:text-slate-600 hover:underline">
          ← חזרה לרשימת הארגונים
        </Link>
      </p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className="font-medium text-slate-700 truncate">{value ?? '—'}</p>
    </div>
  );
}

export default function AdminOrgDetailPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>}>
      <OrgDetailContent />
    </Suspense>
  );
}
