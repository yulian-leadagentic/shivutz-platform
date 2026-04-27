'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Loader2, ArrowRight, AlertTriangle, CheckCircle2,
  Users, FileText, Receipt, ChevronDown,
} from 'lucide-react';
import { adminApi, type AdminDealDetail, type Commission } from '@/lib/adminApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import StatusBadge from '@/components/StatusBadge';

// ── helpers ────────────────────────────────────────────────────────────────

function fmt(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('he-IL');
}

function currency(n?: number | null) {
  if (n == null) return '—';
  return `₪${Number(n).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const COMMISSION_STATUS: Record<string, { label: string; color: string }> = {
  pending:  { label: 'ממתין',     color: 'bg-amber-100 text-amber-700' },
  invoiced: { label: 'חויב',      color: 'bg-blue-100 text-blue-700' },
  paid:     { label: 'שולם',      color: 'bg-green-100 text-green-700' },
  disputed: { label: 'במחלוקת',  color: 'bg-red-100 text-red-700' },
};

// ── Commission create form ─────────────────────────────────────────────────

function CommissionCreateForm({
  dealId,
  onCreated,
}: {
  dealId: string;
  onCreated: (c: Commission) => void;
}) {
  const [gross, setGross]     = useState('');
  const [rate, setRate]       = useState('5');        // default 5%
  const [invNum, setInvNum]   = useState('');
  const [invDate, setInvDate] = useState('');
  const [notes, setNotes]     = useState('');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  const commissionAmt =
    gross && rate ? ((Number(gross) * Number(rate)) / 100).toFixed(2) : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!gross || !rate) return;
    setSaving(true);
    setError('');
    try {
      const c = await adminApi.createCommission(dealId, {
        gross_amount: Number(gross),
        commission_rate: Number(rate) / 100,
        invoice_number: invNum || undefined,
        invoice_date: invDate || undefined,
        notes: notes || undefined,
      });
      onCreated(c);
    } catch (err: unknown) {
      setError((err as Error).message ?? 'שגיאה ביצירת העמלה');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          label="סכום ברוטו (₪)"
          type="number"
          min={0}
          step="0.01"
          value={gross}
          onChange={(e) => setGross(e.target.value)}
          required
        />
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            אחוז עמלה (%)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={1}
              max={20}
              step={0.5}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="flex-1"
            />
            <span className="text-sm font-semibold text-slate-800 w-12 text-center">
              {rate}%
            </span>
          </div>
        </div>
      </div>

      {commissionAmt && (
        <div className="bg-brand-50 border border-brand-200 rounded-lg px-4 py-3 text-center">
          <p className="text-xs text-brand-600 mb-0.5">עמלה מחושבת</p>
          <p className="text-2xl font-bold text-brand-700">₪{commissionAmt}</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          label="מספר חשבונית (אופציונלי)"
          value={invNum}
          onChange={(e) => setInvNum(e.target.value)}
        />
        <Input
          label="תאריך חשבונית (אופציונלי)"
          type="date"
          value={invDate}
          onChange={(e) => setInvDate(e.target.value)}
        />
      </div>
      <Input
        label="הערות (אופציונלי)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      <Button type="submit" disabled={saving || !gross}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}
        צור עמלה
      </Button>
    </form>
  );
}

// ── Commission status card ─────────────────────────────────────────────────

function CommissionCard({ commission, onUpdated }: {
  commission: Commission;
  onUpdated: (c: Commission) => void;
}) {
  const [showActions, setShowActions] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [invNum, setInvNum]     = useState(commission.invoice_number ?? '');
  const [invDate, setInvDate]   = useState(commission.invoice_date ?? '');
  const [invUrl, setInvUrl]     = useState(commission.invoice_url ?? '');

  const sr = COMMISSION_STATUS[commission.status] ?? { label: commission.status, color: 'bg-slate-100 text-slate-600' };

  async function moveTo(status: string) {
    setUpdating(true);
    try {
      await adminApi.updateCommissionStatus(commission.id, {
        status,
        invoice_number: invNum || undefined,
        invoice_date: invDate || undefined,
        invoice_url: invUrl || undefined,
      });
      onUpdated({ ...commission, status: status as Commission['status'], invoice_number: invNum, invoice_date: invDate, invoice_url: invUrl });
    } catch { /* silent */ } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
        <div>
          <p className="text-xs text-slate-400 mb-0.5">סכום ברוטו</p>
          <p className="font-semibold text-slate-800">{currency(commission.gross_amount)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-0.5">אחוז עמלה</p>
          <p className="font-semibold text-slate-800">{(commission.commission_rate * 100).toFixed(1)}%</p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-0.5">עמלה לגבייה</p>
          <p className="font-bold text-brand-700 text-lg">{currency(commission.commission_amount)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-0.5">סטטוס</p>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${sr.color}`}>
            {sr.label}
          </span>
        </div>
      </div>

      {/* Invoice details */}
      {(commission.invoice_number || commission.invoice_date || commission.invoice_url) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm bg-slate-50 rounded-lg p-3">
          {commission.invoice_number && (
            <div>
              <p className="text-xs text-slate-400">מס׳ חשבונית</p>
              <p className="font-medium text-slate-700">{commission.invoice_number}</p>
            </div>
          )}
          {commission.invoice_date && (
            <div>
              <p className="text-xs text-slate-400">תאריך חשבונית</p>
              <p className="font-medium text-slate-700">{fmt(commission.invoice_date)}</p>
            </div>
          )}
          {commission.invoice_url && (
            <div>
              <p className="text-xs text-slate-400">קישור לחשבונית</p>
              <a href={commission.invoice_url} target="_blank" rel="noopener noreferrer"
                className="text-brand-600 underline text-xs truncate block max-w-full">
                פתח חשבונית
              </a>
            </div>
          )}
        </div>
      )}

      {/* Status transition buttons */}
      {commission.status !== 'paid' && (
        <div>
          <button
            onClick={() => setShowActions((s) => !s)}
            className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${showActions ? 'rotate-180' : ''}`} />
            עדכן סטטוס
          </button>

          {showActions && (
            <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Input label="מס׳ חשבונית" value={invNum} onChange={(e) => setInvNum(e.target.value)} />
                <Input label="תאריך חשבונית" type="date" value={invDate} onChange={(e) => setInvDate(e.target.value)} />
                <Input label="קישור לחשבונית" type="url" value={invUrl} onChange={(e) => setInvUrl(e.target.value)} />
              </div>
              <div className="flex gap-2 flex-wrap">
                {commission.status === 'pending' && (
                  <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => moveTo('invoiced')} disabled={updating}>
                    {updating ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    סמן כחויב
                  </Button>
                )}
                <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => moveTo('paid')} disabled={updating}>
                  {updating ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  סמן כשולם ✓
                </Button>
                {commission.status !== 'disputed' && (
                  <Button size="sm" variant="destructive" onClick={() => moveTo('disputed')} disabled={updating}>
                    פתח מחלוקת
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {commission.status === 'paid' && (
        <div className="flex items-center gap-2 text-green-700 text-sm font-medium">
          <CheckCircle2 className="h-4 w-4" />
          עמלה שולמה במלואה
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function AdminDealDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [deal, setDeal]   = useState<AdminDealDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    adminApi.getDeal(id)
      .then(setDeal)
      .catch((e) => setError((e as Error).message ?? 'שגיאה בטעינה'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        <Loader2 className="animate-spin h-6 w-6 me-2" />
        טוען עסקה...
      </div>
    );
  }

  if (error || !deal) {
    return (
      <div className="text-red-600 bg-red-50 border border-red-200 rounded-lg p-4">
        {error || 'העסקה לא נמצאה'}
      </div>
    );
  }

  const contractorReport = deal.reports.find((r) => r.reported_by === 'contractor');
  const corporationReport = deal.reports.find((r) => r.reported_by === 'corporation');
  const canSetCommission  = ['completed', 'reporting', 'disputed'].includes(deal.status);

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Back button */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowRight className="h-4 w-4" />
        חזרה
      </button>

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">עסקה #{id.slice(0, 8)}</h1>
          <p className="text-sm text-slate-500 mt-0.5">נוצרה: {fmt(deal.created_at)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={deal.status} />
          {deal.discrepancy_flag && (
            <span className="flex items-center gap-1 text-xs font-medium bg-red-100 text-red-700 px-2 py-1 rounded-full">
              <AlertTriangle className="h-3 w-3" />
              אי-התאמה
            </span>
          )}
        </div>
      </div>

      {/* Deal summary card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">פרטי העסקה</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-xs text-slate-400 mb-0.5">קבלן</p>
              <p className="font-medium text-slate-800">{deal.contractor_name}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-0.5">תאגיד</p>
              <p className="font-medium text-slate-800">{deal.corporation_name}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-0.5">עובדים</p>
              <p className="font-medium text-slate-800">{deal.workers_count}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-0.5">מחיר מוסכם</p>
              <p className="font-medium text-slate-800">{currency(deal.agreed_price)}</p>
            </div>
            {deal.start_date && (
              <div>
                <p className="text-xs text-slate-400 mb-0.5">תאריך התחלה</p>
                <p className="font-medium text-slate-800">{fmt(deal.start_date)}</p>
              </div>
            )}
            {deal.end_date && (
              <div>
                <p className="text-xs text-slate-400 mb-0.5">תאריך סיום</p>
                <p className="font-medium text-slate-800">{fmt(deal.end_date)}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Workers */}
      {deal.workers.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-brand-600" />
              עובדים משובצים ({deal.workers.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {deal.workers.map((w) => (
                <span key={w.id} className="text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded-full font-mono">
                  {w.id.slice(0, 8)}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Reports */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-brand-600" />
            דוחות ביצוע
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!contractorReport && !corporationReport ? (
            <p className="text-slate-400 text-sm">טרם הוגשו דוחות</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {/* Contractor report */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  דוח קבלן
                </p>
                {contractorReport ? (
                  <div className="space-y-1 text-sm">
                    <p><span className="text-slate-400">עובדים:</span> {contractorReport.actual_workers}</p>
                    <p><span className="text-slate-400">התחלה:</span> {fmt(contractorReport.actual_start_date)}</p>
                    <p><span className="text-slate-400">סיום:</span> {fmt(contractorReport.actual_end_date)}</p>
                    <p><span className="text-slate-400">ימים:</span> {contractorReport.actual_days}</p>
                    <p className="text-xs text-slate-400 mt-1">הוגש: {fmt(contractorReport.submitted_at)}</p>
                  </div>
                ) : (
                  <p className="text-slate-400 text-sm">טרם הוגש</p>
                )}
              </div>

              {/* Corporation report */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  דוח תאגיד
                </p>
                {corporationReport ? (
                  <div className="space-y-1 text-sm">
                    <p><span className="text-slate-400">עובדים:</span> {corporationReport.actual_workers}</p>
                    <p><span className="text-slate-400">התחלה:</span> {fmt(corporationReport.actual_start_date)}</p>
                    <p><span className="text-slate-400">סיום:</span> {fmt(corporationReport.actual_end_date)}</p>
                    <p><span className="text-slate-400">ימים:</span> {corporationReport.actual_days}</p>
                    <p className="text-xs text-slate-400 mt-1">הוגש: {fmt(corporationReport.submitted_at)}</p>
                  </div>
                ) : (
                  <p className="text-slate-400 text-sm">טרם הוגש</p>
                )}
              </div>
            </div>
          )}

          {/* Discrepancy highlight */}
          {deal.discrepancy_flag && deal.discrepancy_details && (
            <div className="mt-4 flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg p-3">
              <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-800">אי-התאמה בין הדוחות</p>
                <p className="text-xs text-red-700 mt-0.5">{JSON.stringify(deal.discrepancy_details)}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Commission */}
      <Card className={deal.commission?.status === 'paid' ? 'border-green-200 bg-green-50/30' : ''}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="h-4 w-4 text-brand-600" />
            עמלה
          </CardTitle>
        </CardHeader>
        <CardContent>
          {deal.commission ? (
            <CommissionCard
              commission={deal.commission}
              onUpdated={(updated) => setDeal((d) => d ? { ...d, commission: updated } : d)}
            />
          ) : canSetCommission ? (
            <CommissionCreateForm
              dealId={id}
              onCreated={(c) => setDeal((d) => d ? { ...d, commission: c } : d)}
            />
          ) : (
            <p className="text-slate-400 text-sm">
              ניתן להגדיר עמלה לאחר שהעסקה מגיעה לסטטוס ״הגשת דוחות״ ומעלה.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
