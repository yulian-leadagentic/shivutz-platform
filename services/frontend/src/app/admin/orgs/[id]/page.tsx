'use client';

import { Suspense, useEffect, useState, FormEvent, useCallback } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight, Loader2, Save, ShieldCheck, ShieldAlert, History as HistoryIcon,
  Upload, Building2, AlertCircle, MessageSquare, Send, X,
} from 'lucide-react';
import { adminApi, type OrgEditPayload, type OrgAuditEntry } from '@/lib/adminApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { OrgSummaryHeader } from '@/components/admin/OrgSummaryHeader';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

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

// Audit-log action codes → Hebrew labels. Anything missing falls back to
// the raw code so we surface, rather than hide, an unknown event type.
const ACTION_LABEL_HE: Record<string, string> = {
  approved:               'אושר',
  rejected:               'נדחה',
  suspended:              'הושעה',
  reactivated:            'הופעל מחדש',
  edited:                 'נערך',
  commission_edited:      'עמלה עודכנה',
  document_uploaded:      'מסמך הועלה',
  document_deleted:       'מסמך נמחק',
  decided:                'אושר',
};

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
  // Native confirm replaced with styled dialog. Suspending an org has
  // cascading consequences (deal queue freezes, member logins fail
  // mid-session) so the dialog spells out what'll happen instead of
  // showing the browser's curt "staging.buildupai.net says ...".
  const [pendingSuspend, setPendingSuspend] = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [error, setError]     = useState('');
  const [toast, setToast]     = useState('');
  const [history, setHistory] = useState<OrgAuditEntry[] | null>(null);
  // QA-R5#5 — quick send-message modal. Pre-fills with the
  // org.contact_phone, lets the admin reference a per-corp deal number
  // so the SMS text starts with "TagidAI — בנוגע לדרישה #C-127:".
  const [messageModalOpen, setMessageModalOpen] = useState(false);

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
  // QA-R5 — auto-load audit history on mount so the last 3 changes
  // surface near the top of the page. Was on-demand via the
  // "היסטוריה" button, which buried the most common admin question
  // ("who flipped this org from pending → approved?") behind a click.
  useEffect(() => {
    let cancelled = false;
    adminApi.orgAudit(id, orgType)
      .then((rows) => { if (!cancelled) setHistory(rows); })
      .catch(() => { /* button is the fallback */ });
    return () => { cancelled = true; };
  }, [id, orgType]);

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
    // Reroute suspension through the confirm dialog. Other transitions
    // (e.g. re-activation) don't need a confirm.
    if (status === 'suspended') { setPendingSuspend(true); return; }
    setStatusBusy(true);
    try {
      await adminApi.setOrgStatus(id, orgType, status);
      pushToast('✓ הארגון הופעל מחדש');
      load();
    } catch (err) {
      pushToast(`✗ ${err instanceof Error ? err.message : 'שגיאה'}`);
    } finally {
      setStatusBusy(false);
    }
  }
  async function confirmSuspend() {
    setStatusBusy(true);
    try {
      await adminApi.setOrgStatus(id, orgType, 'suspended');
      pushToast('✓ הארגון הושהה');
      load();
      setPendingSuspend(false);
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
    <div className="max-w-6xl space-y-4">
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
                <span className="text-xs text-slate-500">
                  {{
                    tier_1: 'אימות חלקי — נמצא ברשם בלבד',
                    tier_2: 'אימות מלא — אומת מול הקבלן/התאגיד',
                  }[org.verification_tier as 'tier_1' | 'tier_2'] ?? org.verification_tier}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {form.contact_phone && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMessageModalOpen(true)}
              disabled={!form.contact_phone}
              title={`שלח SMS ל-${form.contact_phone}`}
            >
              <MessageSquare className="h-3.5 w-3.5" /> שלח הודעה
            </Button>
          )}
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

      {/* Single-glance summary: deal counts + team + workers/searches +
          gov data + recent deals. Sits above the edit form so the
          admin sees the state of the org before they edit it. */}
      <OrgSummaryHeader orgId={id} orgType={orgType} />

      {/* QA-R5 — last 3 audit entries inline so the admin's most
          common question ("who flipped this org from pending →
          approved?") is answered before they have to click
          "היסטוריה". Falls back silently if the audit endpoint
          fails. Full log still available via the כפתור below. */}
      {history && history.length > 0 && (
        <Card className="border-slate-200 bg-slate-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-600 flex items-center gap-2">
              <HistoryIcon className="h-3.5 w-3.5" /> שינויים אחרונים
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="text-sm divide-y divide-slate-200">
              {history.slice(0, 3).map((h) => (
                <li key={h.log_id} className="py-2 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-slate-800">{ACTION_LABEL_HE[h.action] ?? h.action}</span>
                    <span className="text-xs text-slate-500 whitespace-nowrap" dir="ltr">{fmtDate(h.created_at)}</span>
                  </div>
                  {/* Actor identity not yet returned by orgAudit (only
                      actor_id) — add when the API surfaces actor_name. */}
                </li>
              ))}
            </ul>
            {history.length > 3 && (
              <p className="text-xs text-slate-400 mt-2">
                ועוד {history.length - 3} שינויים — לחץ "היסטוריה" בראש הדף לראות הכל.
              </p>
            )}
          </CardContent>
        </Card>
      )}

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
                      <span className="font-medium">{ACTION_LABEL_HE[h.action] ?? h.action}</span>
                      <span className="text-xs text-slate-400" dir="ltr">{fmtDate(h.created_at)}</span>
                    </div>
                    {/* QA-R5 — was rendering the raw JSON metadata
                        as `<pre>{JSON.stringify(...)}</pre>` which made
                        the audit log nearly unreadable. Now formats
                        each key as a labelled dl row. Falls back to
                        stringify only when the value isn't a flat
                        object (e.g. nested {old, new} diffs). */}
                    {h.metadata && typeof h.metadata === 'object' && (
                      <dl className="mt-1.5 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-xs">
                        {Object.entries(h.metadata as Record<string, unknown>).map(([k, v]) => {
                          const rendered = (v === null || v === undefined) ? '—'
                            : typeof v === 'object' ? JSON.stringify(v)
                            : String(v);
                          return (
                            <div key={k} className="contents">
                              <dt className="text-slate-400 font-medium">{k}</dt>
                              <dd className="text-slate-700 break-all">{rendered}</dd>
                            </div>
                          );
                        })}
                      </dl>
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
        <div className={`fixed top-4 start-4 end-4 sm:end-auto sm:top-auto sm:bottom-6 sm:start-6 px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white z-50 ${toast.startsWith('✓') ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast}
        </div>
      )}

      <p className="text-center pt-2">
        <Link href="/admin/orgs" className="text-xs text-slate-400 hover:text-slate-600 hover:underline">
          ← חזרה לרשימת הארגונים
        </Link>
      </p>

      <ConfirmDialog
        open={pendingSuspend}
        title="השהיית ארגון"
        message="להשהות את הארגון? משתמשים שמחוברים כרגע ינותקו, עסקאות פתוחות יוקפאו, והארגון לא יוכל להגיש פניות או לפרסם עובדים עד שתשחרר אותו מההשהיה."
        confirmLabel="השהה"
        variant="destructive"
        busy={statusBusy}
        onConfirm={confirmSuspend}
        onCancel={() => setPendingSuspend(false)}
      />

      {messageModalOpen && (
        <SendMessageModal
          orgId={id}
          orgType={orgType}
          orgName={org?.company_name_he || org?.company_name || ''}
          contactPhone={form.contact_phone || ''}
          onClose={() => setMessageModalOpen(false)}
        />
      )}
    </div>
  );
}

function SendMessageModal({ orgId, orgType, orgName, contactPhone, onClose }: {
  orgId: string;
  orgType: OrgType;
  orgName: string;
  contactPhone: string;
  onClose: () => void;
}) {
  const [phone,   setPhone]   = useState(contactPhone);
  const [dealNo,  setDealNo]  = useState<number | ''>('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error,   setError]   = useState('');
  const [recent,  setRecent]  = useState<Array<{ id: string; corp_deal_no: number | null; profession_he: string | null; status: string }>>([]);

  // Pull the org's recent deals so the admin can pick one to reference.
  // Corp side surfaces corp_deal_no; contractor side shows the search/UUID.
  useEffect(() => {
    adminApi.getOrgSummary(orgId, orgType)
      .then((s) => setRecent(
        s.recent_deals
          .filter((d) => orgType === 'contractor' || d.corp_deal_no != null)
          .map((d) => ({
            id:            d.id,
            corp_deal_no:  d.corp_deal_no,
            profession_he: d.profession_he,
            status:        d.status,
          })),
      ))
      .catch(() => { /* picker stays empty — admin can still send free-form */ });
  }, [orgId, orgType]);

  // Whenever the admin picks a deal #, prefill the message body with a
  // ready-made opener so they only have to add the actual request.
  useEffect(() => {
    if (dealNo === '' || !orgName) return;
    const opener = orgType === 'corporation' && dealNo
      ? `TagidAI — שלום, בנוגע לדרישה #C-${dealNo} ב${orgName}: `
      : `TagidAI — שלום ${orgName}, `;
    setMessage((cur) => cur.startsWith('TagidAI —') ? opener : (cur || opener));
  }, [dealNo, orgName, orgType]);

  async function send() {
    setError('');
    if (!phone.trim()) { setError('יש להזין מספר טלפון'); return; }
    if (!message.trim() || message.trim().length < 5) { setError('יש להזין הודעה'); return; }
    setSending(true);
    try {
      await adminApi.sendAdminMessage({
        phone:        phone.trim(),
        message:      message.trim(),
        org_id:       orgId,
        org_type:     orgType,
        corp_deal_no: dealNo === '' ? undefined : Number(dealNo),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שליחה נכשלה');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4" onClick={() => !sending && onClose()}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 p-5 pb-3 border-b border-slate-100">
          <div className="h-10 w-10 rounded-xl bg-brand-50 text-brand-700 flex items-center justify-center shrink-0">
            <MessageSquare className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-slate-900 leading-tight">שלח הודעה</h2>
            <p className="text-sm text-slate-500 mt-0.5">{orgName}</p>
          </div>
          <button type="button" onClick={onClose} disabled={sending} aria-label="סגור" className="h-8 w-8 inline-flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 disabled:opacity-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">טלפון יעד</label>
            <input dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+972500000000" className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>

          {recent.length > 0 && (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-slate-700">צרף הפניה לדרישה (לא חובה)</label>
              <select value={dealNo} onChange={(e) => setDealNo(e.target.value === '' ? '' : Number(e.target.value))} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="">— ללא —</option>
                {recent.map((d) => (
                  <option key={d.id} value={d.corp_deal_no ?? 0}>
                    {d.corp_deal_no != null ? `#C-${d.corp_deal_no}` : '—'} · {d.profession_he ?? '—'} · {d.status}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">הודעה</label>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} placeholder="..." className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            <span className="text-xs text-slate-400">{message.length}/320 תווים — SMS ארוך יישבר ל-2 הודעות.</span>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={sending} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium text-sm disabled:opacity-50">
              ביטול
            </button>
            <button type="button" onClick={send} disabled={sending} className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm shadow-sm disabled:opacity-50">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              שלח SMS
            </button>
          </div>
        </div>
      </div>
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
