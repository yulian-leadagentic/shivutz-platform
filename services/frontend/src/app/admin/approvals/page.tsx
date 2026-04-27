'use client';

import { useEffect, useState, useCallback, Suspense, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Loader2, CheckCircle, XCircle, Clock, ChevronDown, ChevronUp,
  Pencil, Upload, History,
} from 'lucide-react';
import { adminApi, type PendingOrg, type OrgEditPayload, type OrgAuditEntry } from '@/lib/adminApi';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const DEFAULT_COMMISSION = 500;

function hoursLeft(iso: string) {
  const diff = new Date(iso).getTime() - Date.now();
  const h = Math.round(diff / 3_600_000);
  if (h < 0) return { label: 'פג SLA', urgent: true };
  if (h < 8) return { label: `${h}ש' נותרו`, urgent: true };
  return { label: `${h}ש' נותרו`, urgent: false };
}

function OrgRow({
  org,
  highlighted,
  onDecide,
  onLocalEdit,
  onToast,
}: {
  org: PendingOrg;
  highlighted: boolean;
  onDecide: (id: string, orgType: string, approved: boolean, reason: string | undefined,
             commission: number) => Promise<void>;
  onLocalEdit: (id: string, patch: Partial<PendingOrg>) => void;
  onToast: (msg: string) => void;
}) {
  const [expanded, setExpanded] = useState(highlighted);
  const [deciding, setDeciding] = useState<'approve' | 'reject' | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [commission, setCommission] = useState<string>(
    String(org.commission_per_worker_amount ?? DEFAULT_COMMISSION)
  );
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<OrgEditPayload>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<OrgAuditEntry[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const sla = hoursLeft(org.approval_sla_deadline);

  async function approve() {
    const amount = parseFloat(commission);
    if (Number.isNaN(amount) || amount < 0) {
      onToast('✗ עמלה לא תקינה');
      return;
    }
    setDeciding('approve');
    await onDecide(org.id, org.org_type, true, undefined, amount);
    setDeciding(null);
  }

  async function reject() {
    if (!showRejectInput) { setShowRejectInput(true); setExpanded(true); return; }
    setDeciding('reject');
    await onDecide(org.id, org.org_type, false, rejectReason, parseFloat(commission) || DEFAULT_COMMISSION);
    setDeciding(null);
  }

  function startEdit() {
    setEditForm({
      company_name_he: org.company_name_he,
      company_name:    org.company_name,
      contact_name:    org.contact_name,
      contact_email:   org.contact_email,
      contact_phone:   org.contact_phone,
      commission_per_worker_amount: org.commission_per_worker_amount ?? DEFAULT_COMMISSION,
    });
    setEditing(true);
    setExpanded(true);
  }

  async function saveEdit() {
    setSavingEdit(true);
    try {
      await adminApi.editOrg(org.id, org.org_type, editForm);
      onLocalEdit(org.id, editForm as Partial<PendingOrg>);
      onToast('✓ הפרטים עודכנו');
      setEditing(false);
    } catch (e) {
      onToast('✗ שגיאה בעדכון');
      console.error(e);
    } finally {
      setSavingEdit(false);
    }
  }

  async function loadHistory() {
    setShowHistory(true);
    try {
      const rows = await adminApi.orgAudit(org.id, org.org_type);
      setHistory(rows);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await adminApi.uploadOrgDocument(org.org_type, org.id, file);
      onToast(`✓ ${file.name} הועלה`);
    } catch (err) {
      onToast('✗ שגיאה בהעלאת המסמך');
      console.error(err);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <Card className={`transition-all ${highlighted ? 'ring-2 ring-amber-400' : ''}`}>
      {/* Header row */}
      <CardHeader
        className="pb-3 cursor-pointer select-none"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <Badge variant={org.org_type === 'contractor' ? 'default' : 'secondary'}>
              {org.org_type === 'contractor' ? 'קבלן' : 'תאגיד'}
            </Badge>
            {org.org_type === 'contractor' && org.verification_tier && (
              <Badge
                variant="outline"
                className={
                  org.verification_tier === 'tier_2' ? 'border-emerald-500 text-emerald-700' :
                  org.verification_tier === 'tier_1' ? 'border-blue-500 text-blue-700' :
                  'border-slate-300 text-slate-600'
                }
              >
                {org.verification_tier === 'tier_2' ? 'מאומת' :
                 org.verification_tier === 'tier_1' ? 'במאגר' :
                 'לא נמצא'}
              </Badge>
            )}
            <CardTitle className="text-base">{org.company_name}</CardTitle>
            {org.company_name_he && (
              <span className="text-sm text-slate-500">{org.company_name_he}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-medium px-2 py-1 rounded-full ${sla.urgent ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
              <Clock className="inline h-3 w-3 me-1" />{sla.label}
            </span>
            {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 space-y-4">
          {/* Details grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            {[
              ['איש קשר', org.contact_name],
              ['אימייל',  org.contact_email],
              ['טלפון',   org.contact_phone],
              ['ח.פ / ע.מ', org.business_number],
              ['נרשם',    new Date(org.created_at).toLocaleDateString('he-IL')],
              ...(org.org_type === 'contractor'
                ? ([
                    ['מספר קבלן',   org.kablan_number || '—'],
                    ['סיווג',       org.kvutza && org.sivug ? `${org.kvutza}-${org.sivug}` : '—'],
                    ['ענף',         org.gov_branch || '—'],
                    ['רשם החברות',  org.gov_company_status || '—'],
                  ] as Array<[string, string]>)
                : []),
            ].map(([k, v]) => (
              <div key={k}>
                <p className="text-slate-400 text-xs">{k}</p>
                <p className="font-medium text-slate-800 truncate">{v || '—'}</p>
              </div>
            ))}
          </div>

          {/* Commission input — defaults to 500₪ per worker, editable per entity */}
          {!editing && (
            <div className="flex items-end gap-3">
              <div className="flex-1 max-w-xs">
                <label className="text-xs text-slate-500 block mb-1">עמלת פלטפורמה לעובד (₪)</label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={commission}
                    onChange={e => setCommission(e.target.value)}
                    dir="ltr"
                    className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 pe-8 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">₪</span>
                </div>
              </div>
              <p className="text-xs text-slate-400 pb-2">ברירת מחדל: ₪{DEFAULT_COMMISSION}</p>
            </div>
          )}

          {/* Inline edit form */}
          {editing && (
            <div className="border border-slate-200 rounded-lg p-3 bg-slate-50 space-y-2.5">
              <p className="text-xs font-semibold text-slate-600">עריכת פרטי הארגון</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">שם החברה (עברית)</label>
                  <input value={editForm.company_name_he ?? ''}
                    onChange={e => setEditForm(p => ({ ...p, company_name_he: e.target.value }))}
                    className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">איש קשר</label>
                  <input value={editForm.contact_name ?? ''}
                    onChange={e => setEditForm(p => ({ ...p, contact_name: e.target.value }))}
                    className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">אימייל</label>
                  <input value={editForm.contact_email ?? ''}
                    onChange={e => setEditForm(p => ({ ...p, contact_email: e.target.value }))}
                    dir="ltr"
                    className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">טלפון</label>
                  <input value={editForm.contact_phone ?? ''}
                    onChange={e => setEditForm(p => ({ ...p, contact_phone: e.target.value }))}
                    dir="ltr"
                    className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">עמלה לעובד (₪)</label>
                  <input type="number" step="0.01" min="0"
                    value={editForm.commission_per_worker_amount ?? DEFAULT_COMMISSION}
                    onChange={e => setEditForm(p => ({ ...p, commission_per_worker_amount: parseFloat(e.target.value) }))}
                    dir="ltr"
                    className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm" />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={saveEdit} disabled={savingEdit}>
                  {savingEdit ? <Loader2 className="h-3 w-3 animate-spin" /> : 'שמור'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>ביטול</Button>
              </div>
            </div>
          )}

          {/* Reject reason input */}
          {showRejectInput && (
            <div>
              <label className="text-sm text-slate-600 block mb-1">סיבת דחייה (אופציונלי)</label>
              <textarea
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
                rows={2}
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="הסבר לארגון מדוע בקשתו נדחתה..."
              />
            </div>
          )}

          {/* Audit history */}
          {showHistory && (
            <div className="border border-slate-200 rounded-lg p-3 bg-slate-50 max-h-48 overflow-y-auto">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-600">היסטוריית שינויים</p>
                <button onClick={() => setShowHistory(false)} className="text-xs text-slate-400 hover:text-slate-600">סגור</button>
              </div>
              {history.length === 0 ? (
                <p className="text-xs text-slate-400">אין רישומים</p>
              ) : (
                <ul className="space-y-1.5 text-xs text-slate-600">
                  {history.map(h => (
                    <li key={h.log_id} className="border-b border-slate-200 pb-1.5 last:border-0">
                      <span className="font-medium">{h.action}</span>
                      <span className="text-slate-400 mx-1">·</span>
                      <span dir="ltr">{new Date(h.created_at).toLocaleString('he-IL')}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 flex-wrap items-center">
            <Button
              size="sm"
              onClick={approve}
              disabled={deciding !== null || editing}
              className="bg-green-600 hover:bg-green-700"
            >
              {deciding === 'approve' ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
              אשר
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={reject}
              disabled={deciding !== null || editing}
            >
              {deciding === 'reject' ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
              {showRejectInput ? 'אשר דחייה' : 'דחה'}
            </Button>
            {showRejectInput && (
              <Button size="sm" variant="ghost" onClick={() => setShowRejectInput(false)}>ביטול</Button>
            )}

            <div className="flex-1" />

            {!editing && (
              <Button size="sm" variant="outline" onClick={startEdit} title="עריכת פרטים">
                <Pencil className="h-3 w-3" /> ערוך
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}
                    disabled={uploading} title="העלה מסמך">
              {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              מסמך
            </Button>
            <input ref={fileRef} type="file" className="hidden" onChange={handleFile} />
            <Button size="sm" variant="outline" onClick={loadHistory} title="היסטוריה">
              <History className="h-3 w-3" /> היסטוריה
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function ApprovalsContent() {
  const searchParams = useSearchParams();
  const highlight = searchParams.get('highlight') ?? '';

  const [orgs, setOrgs] = useState<PendingOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<string[]>([]);

  const load = useCallback(() => {
    setLoading(true);
    adminApi.pendingApprovals()
      .then(setOrgs)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  function pushToast(msg: string) {
    setToasts(t => [...t, msg]);
    setTimeout(() => setToasts(t => t.slice(1)), 4000);
  }

  async function handleDecide(id: string, orgType: string, approved: boolean,
                              reason: string | undefined, commission: number) {
    try {
      const result = await adminApi.decide(id, orgType, approved, reason, commission);
      pushToast(approved ? `✓ ${result.company_name} אושר בהצלחה` : `✗ ${result.company_name} נדחה`);
      setOrgs(prev => prev.filter(o => o.id !== id));
    } catch (e) {
      pushToast(`✗ ${e instanceof Error ? e.message : 'שגיאה'}`);
      console.error(e);
    }
  }

  function handleLocalEdit(id: string, patch: Partial<PendingOrg>) {
    setOrgs(prev => prev.map(o => o.id === id ? { ...o, ...patch } : o));
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900">
          ממתינים לאישור
          {orgs.length > 0 && (
            <span className="ms-2 text-sm font-normal text-slate-500">({orgs.length})</span>
          )}
        </h2>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'רענן'}
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 bg-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : orgs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500">
            <CheckCircle className="h-10 w-10 mx-auto text-green-500 mb-3" />
            אין ארגונים הממתינים לאישור
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {orgs.map(org => (
            <OrgRow
              key={org.id}
              org={org}
              highlighted={org.id === highlight}
              onDecide={handleDecide}
              onLocalEdit={handleLocalEdit}
              onToast={pushToast}
            />
          ))}
        </div>
      )}

      {/* Toast stack */}
      <div className="fixed bottom-6 start-6 space-y-2 z-50">
        {toasts.map((msg, i) => (
          <div
            key={i}
            className={`px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white ${
              msg.startsWith('✓') ? 'bg-green-600' : 'bg-red-600'
            }`}
          >
            {msg}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ApprovalsPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-12"><span className="text-slate-400 text-sm">טוען...</span></div>}>
      <ApprovalsContent />
    </Suspense>
  );
}
