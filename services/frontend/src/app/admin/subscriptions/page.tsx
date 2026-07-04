'use client';

// Pivot/v2 admin — subscriptions oversight.

import { useEffect, useState } from 'react';
import { Loader2, Clock, Gift, Ban } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';

type Status = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired';
type Tier   = 'basic' | 'advanced' | 'pro';

interface AdminSubRow {
  id: string;
  entity_id: string;
  entity_type: 'contractor' | 'corporation';
  entity_name: string | null;
  tier: Tier;
  status: Status;
  trial_ends_at: string | null;
  current_period_end: string | null;
  updated_at: string;
}

const STATUS_LABEL: Record<Status, string> = {
  trialing: 'ניסיון', active: 'פעיל', past_due: 'תשלום נכשל', cancelled: 'בוטל', expired: 'פג',
};
const TIER_LABEL: Record<Tier, string> = { basic: 'בסיסי', advanced: 'מתקדם', pro: 'פרו' };

export default function AdminSubscriptionsPage() {
  const [rows, setRows]       = useState<AdminSubRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [busy, setBusy]       = useState<string | null>(null);
  const [statusFilter, setStatus] = useState<'' | Status>('');

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      setRows(await apiFetch<AdminSubRow[]>(`/admin/subscriptions?${params.toString()}`));
    } catch (e) { setError((e as Error).message ?? ''); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, [statusFilter]);

  async function extendTrial(row: AdminSubRow) {
    const dStr = prompt('הארך ניסיון בכמה ימים?', '14');
    if (!dStr) return;
    const days = parseInt(dStr, 10);
    if (!Number.isFinite(days) || days < 1) return;
    setBusy(row.id);
    try { await apiFetch(`/admin/subscriptions/${row.id}/extend-trial`, { method: 'POST', body: JSON.stringify({ days }) }); await refresh(); }
    catch (e) { setError((e as Error).message ?? ''); }
    finally { setBusy(null); }
  }

  async function grant(row: AdminSubRow) {
    const tier = prompt('טיר להענקה: basic / advanced / pro', row.tier);
    if (!tier || !['basic','advanced','pro'].includes(tier)) return;
    const mStr = prompt('לכמה חודשים?', '1');
    if (!mStr) return;
    const months = parseInt(mStr, 10);
    if (!Number.isFinite(months) || months < 1) return;
    setBusy(row.id);
    try { await apiFetch(`/admin/subscriptions/${row.id}/grant`, { method: 'POST', body: JSON.stringify({ tier, months }) }); await refresh(); }
    catch (e) { setError((e as Error).message ?? ''); }
    finally { setBusy(null); }
  }

  async function revoke(row: AdminSubRow) {
    if (!confirm(`לבטל מנוי של "${row.entity_name || row.entity_id}"?`)) return;
    setBusy(row.id);
    try { await apiFetch(`/admin/subscriptions/${row.id}/revoke`, { method: 'POST' }); await refresh(); }
    catch (e) { setError((e as Error).message ?? ''); }
    finally { setBusy(null); }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">מנויים</h1>
        <p className="text-sm text-slate-500">הארכת ניסיון · הענקת טיר · ביטול</p>
      </header>

      <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm flex items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatus(e.target.value as '' | Status)}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white"
        >
          <option value="">כל הסטטוסים</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-16"><Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400" /></div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500">
          אין מנויים תואמים
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 uppercase">
              <tr>
                <th className="text-start px-3 py-2">ישות</th>
                <th className="text-start px-3 py-2">סוג</th>
                <th className="text-start px-3 py-2">טיר</th>
                <th className="text-start px-3 py-2">סטטוס</th>
                <th className="text-start px-3 py-2">ניסיון עד</th>
                <th className="text-start px-3 py-2">חיוב הבא</th>
                <th className="text-end px-3 py-2">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-900">{r.entity_name || r.entity_id.slice(0, 8)}</td>
                  <td className="px-3 py-2 text-slate-600">{r.entity_type === 'contractor' ? 'קבלן' : 'תאגיד'}</td>
                  <td className="px-3 py-2 text-slate-600">{TIER_LABEL[r.tier]}</td>
                  <td className="px-3 py-2">
                    <span className={`text-xs font-semibold rounded-full px-2 py-0.5 border ${
                      r.status === 'active'    ? 'text-emerald-700 bg-emerald-50 border-emerald-200' :
                      r.status === 'trialing'  ? 'text-amber-700   bg-amber-50   border-amber-200'   :
                      r.status === 'past_due'  ? 'text-red-700     bg-red-50     border-red-200'     :
                                                 'text-slate-700   bg-slate-100  border-slate-200'
                    }`}>{STATUS_LABEL[r.status]}</span>
                  </td>
                  <td className="px-3 py-2 text-slate-500 text-xs">{r.trial_ends_at ? new Date(r.trial_ends_at).toLocaleDateString('he-IL') : '—'}</td>
                  <td className="px-3 py-2 text-slate-500 text-xs">{r.current_period_end ? new Date(r.current_period_end).toLocaleDateString('he-IL') : '—'}</td>
                  <td className="px-3 py-2 text-end">
                    <div className="inline-flex items-center gap-2">
                      <button onClick={() => extendTrial(r)} disabled={busy === r.id} className="inline-flex items-center gap-1 text-xs text-amber-700 hover:bg-amber-50 px-2 py-1 rounded disabled:opacity-50">
                        <Clock className="w-3.5 h-3.5" /> הארך ניסיון
                      </button>
                      <button onClick={() => grant(r)} disabled={busy === r.id} className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:bg-emerald-50 px-2 py-1 rounded disabled:opacity-50">
                        <Gift className="w-3.5 h-3.5" /> הענק
                      </button>
                      <button onClick={() => revoke(r)} disabled={busy === r.id} className="inline-flex items-center gap-1 text-xs text-red-700 hover:bg-red-50 px-2 py-1 rounded disabled:opacity-50">
                        <Ban className="w-3.5 h-3.5" /> בטל
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
