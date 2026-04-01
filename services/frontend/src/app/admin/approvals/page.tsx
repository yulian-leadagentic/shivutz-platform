'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, CheckCircle, XCircle, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { adminApi, type PendingOrg } from '@/lib/adminApi';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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
}: {
  org: PendingOrg;
  highlighted: boolean;
  onDecide: (id: string, orgType: string, approved: boolean, reason?: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(highlighted);
  const [deciding, setDeciding] = useState<'approve' | 'reject' | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const sla = hoursLeft(org.approval_sla_deadline);

  async function approve() {
    setDeciding('approve');
    await onDecide(org.id, org.org_type, true);
    setDeciding(null);
  }

  async function reject() {
    if (!showRejectInput) { setShowRejectInput(true); setExpanded(true); return; }
    setDeciding('reject');
    await onDecide(org.id, org.org_type, false, rejectReason);
    setDeciding(null);
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
            ].map(([k, v]) => (
              <div key={k}>
                <p className="text-slate-400 text-xs">{k}</p>
                <p className="font-medium text-slate-800 truncate">{v || '—'}</p>
              </div>
            ))}
          </div>

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

          {/* Action buttons */}
          <div className="flex gap-3 flex-wrap">
            <Button
              size="sm"
              onClick={approve}
              disabled={deciding !== null}
              className="bg-green-600 hover:bg-green-700"
            >
              {deciding === 'approve' ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
              אשר
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={reject}
              disabled={deciding !== null}
            >
              {deciding === 'reject' ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
              {showRejectInput ? 'אשר דחייה' : 'דחה'}
            </Button>
            {showRejectInput && (
              <Button size="sm" variant="ghost" onClick={() => setShowRejectInput(false)}>
                ביטול
              </Button>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export default function ApprovalsPage() {
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

  async function handleDecide(id: string, orgType: string, approved: boolean, reason?: string) {
    try {
      const result = await adminApi.decide(id, orgType, approved, reason);
      const msg = approved
        ? `✓ ${result.company_name} אושר בהצלחה`
        : `✗ ${result.company_name} נדחה`;
      setToasts(t => [...t, msg]);
      setTimeout(() => setToasts(t => t.slice(1)), 4000);
      setOrgs(prev => prev.filter(o => o.id !== id));
    } catch (e) {
      console.error(e);
    }
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
