'use client';

// Pivot/v2 admin — subscriptions oversight.

import { useEffect, useState } from 'react';
import { Loader2, Clock, Gift, Ban, HandCoins, AlertCircle } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import { mapApiError } from '@/lib/api/errors';
import {
  SUBSCRIPTION_STATUS_HE_SHORT,
  TIER_HE_SHORT,
} from '@/lib/labels';

// R9 §5 · comped is a first-class status. Admin lists filter on it,
// converts to it, and the badge distinguishes it from paid `active`.
type Status = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired' | 'comped';
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
  // R9 §4 · server-computed (in admin/subscriptions.py list_subscriptions);
  // NULL for statuses where a countdown doesn't apply (past_due,
  // cancelled, expired, comped).
  days_remaining: number | null;
  updated_at: string;
}

// R9 §3 · surfaced from /admin/subscriptions/skip-summary. Aggregate
// only — a per-skip email would flood inboxes during a free launch.
interface SkipSummary {
  count:            number;
  total_amount_nis: number;
  last_at:          string | null;
  month_start:      string;
}

// U8 §1 — moved to lib/labels.ts (SUBSCRIPTION_STATUS_HE_SHORT +
// TIER_HE_SHORT). Aliased here to keep the call sites tight.
const STATUS_LABEL = SUBSCRIPTION_STATUS_HE_SHORT;
const TIER_LABEL   = TIER_HE_SHORT;

export default function AdminSubscriptionsPage() {
  const [rows, setRows]       = useState<AdminSubRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [busy, setBusy]       = useState<string | null>(null);
  const [statusFilter, setStatus] = useState<'' | Status>('');
  // R9 §4 · sort by days-remaining so imminent expirations bubble up.
  // Values without a countdown (comped, expired…) sink to the bottom.
  const [sortByDays, setSortByDays] = useState(false);
  // R9 §3 · monthly skip aggregate — refreshed alongside the list.
  const [skip, setSkip] = useState<SkipSummary | null>(null);

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      const [subs, summary] = await Promise.all([
        apiFetch<AdminSubRow[]>(`/admin/subscriptions?${params.toString()}`),
        apiFetch<SkipSummary>('/admin/subscriptions/skip-summary').catch(() => null),
      ]);
      setRows(subs);
      setSkip(summary);
    } catch (e) { setError(mapApiError(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, [statusFilter]);

  // Local sort — NULL days-remaining sinks to the end so a screenful
  // of comped rows doesn't push the almost-expired ones off screen.
  const displayRows = sortByDays
    ? [...rows].sort((a, b) => {
        const da = a.days_remaining ?? Number.POSITIVE_INFINITY;
        const db = b.days_remaining ?? Number.POSITIVE_INFINITY;
        return da - db;
      })
    : rows;

  async function extendTrial(row: AdminSubRow) {
    const dStr = prompt('הארך ניסיון בכמה ימים?', '14');
    if (!dStr) return;
    const days = parseInt(dStr, 10);
    if (!Number.isFinite(days) || days < 1) return;
    setBusy(row.id);
    try { await apiFetch(`/admin/subscriptions/${row.id}/extend-trial`, { method: 'POST', body: JSON.stringify({ days }) }); await refresh(); }
    catch (e) { setError(mapApiError(e)); }
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
    catch (e) { setError(mapApiError(e)); }
    finally { setBusy(null); }
  }

  async function revoke(row: AdminSubRow) {
    if (!confirm(`לבטל מנוי של "${row.entity_name || row.entity_id}"?`)) return;
    setBusy(row.id);
    try { await apiFetch(`/admin/subscriptions/${row.id}/revoke`, { method: 'POST' }); await refresh(); }
    catch (e) { setError(mapApiError(e)); }
    finally { setBusy(null); }
  }

  // R9 §5 · convert to comped. Note is mandatory (backend enforces
  // 400 on blank), audit log gets from_status → 'comped' + the note.
  async function convertToComped(row: AdminSubRow) {
    if (row.status === 'comped') {
      alert('המנוי כבר מוגדר כפטור מחיוב.');
      return;
    }
    const note = prompt(
      `להעביר את "${row.entity_name || row.entity_id}" למנוי פעיל · ללא חיוב?\n\nהערה (חובה — נכנסת לאודיט):`,
      '',
    );
    if (note === null) return;
    const trimmed = note.trim();
    if (!trimmed) { alert('חייבים הערה.'); return; }
    setBusy(row.id);
    try {
      await apiFetch(`/admin/subscriptions/${row.id}/comp`, {
        method: 'POST',
        body:   JSON.stringify({ note: trimmed }),
      });
      await refresh();
    } catch (e) { setError(mapApiError(e)); }
    finally { setBusy(null); }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">מנויים</h1>
        <p className="text-sm text-slate-500">הארכת ניסיון · הענקת טיר · ביטול</p>
      </header>

      {/* R9 §3 · monthly skip aggregate. `count` is "how many subs got
          a free month because they have no PM on file"; `total` is
          "how much we didn't charge". Zero counts still render (as
          "0 מנויים · ₪0") so the admin can tell "endpoint returned
          zero" apart from "endpoint failed". */}
      {skip && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-700 flex items-center justify-center shrink-0">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-900">חידושים שדולגו החודש</div>
              <p className="text-xs text-slate-500 mt-0.5">
                מנוי פעיל בלי אמצעי תשלום אינו מושעה: תקופת החיוב מוארכת ונרשם אירוע audit. אין דוא״ל לכל דילוג — סופרים כאן.
              </p>
              <div className="mt-2 flex items-baseline gap-4 flex-wrap text-sm">
                <span className="font-bold text-slate-900">{skip.count} מנויים</span>
                <span className="text-slate-500">·</span>
                <span className="font-bold text-slate-900">₪{skip.total_amount_nis.toLocaleString('he-IL')}</span>
                <span className="text-xs text-slate-400">
                  {skip.last_at
                    ? `אחרון: ${new Date(skip.last_at).toLocaleDateString('he-IL')}`
                    : 'אין דילוגים החודש'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm flex items-center gap-3 flex-wrap">
        <select
          value={statusFilter}
          onChange={(e) => setStatus(e.target.value as '' | Status)}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white"
        >
          <option value="">כל הסטטוסים</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={sortByDays}
            onChange={(e) => setSortByDays(e.target.checked)}
          />
          מיין לפי ימים שנותרו
        </label>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-16"><Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400" /></div>
      ) : error ? (
        // U11 §1 · when the fetch failed, DO NOT also render the empty
        // state — the red banner above already tells the user what
        // happened, and "אין מנויים תואמים" would mislead an admin
        // scrolling past the banner into thinking the DB is empty.
        null
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
                <th className="text-start px-3 py-2">נותרו</th>
                <th className="text-start px-3 py-2">ניסיון עד</th>
                <th className="text-start px-3 py-2">חיוב הבא</th>
                <th className="text-end px-3 py-2">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-900">{r.entity_name || r.entity_id.slice(0, 8)}</td>
                  <td className="px-3 py-2 text-slate-600">{r.entity_type === 'contractor' ? 'קבלן' : 'תאגיד'}</td>
                  <td className="px-3 py-2 text-slate-600">{TIER_LABEL[r.tier]}</td>
                  <td className="px-3 py-2">
                    <span className={`text-xs font-semibold rounded-full px-2 py-0.5 border ${
                      r.status === 'active'    ? 'text-emerald-700 bg-emerald-50 border-emerald-200' :
                      r.status === 'trialing'  ? 'text-amber-700   bg-amber-50   border-amber-200'   :
                      r.status === 'past_due'  ? 'text-red-700     bg-red-50     border-red-200'     :
                      // R9 §5 · comped is distinct from active — same "OK, keep working" outcome,
                      // different origin (admin-granted, not paid), different follow-up path.
                      r.status === 'comped'    ? 'text-sky-700     bg-sky-50     border-sky-200'     :
                                                 'text-slate-700   bg-slate-100  border-slate-200'
                    }`}>{STATUS_LABEL[r.status]}</span>
                  </td>
                  <td className="px-3 py-2 text-slate-500 text-xs">
                    {r.days_remaining != null ? `${r.days_remaining} ימים` : '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-500 text-xs">{r.trial_ends_at ? new Date(r.trial_ends_at).toLocaleDateString('he-IL') : '—'}</td>
                  <td className="px-3 py-2 text-slate-500 text-xs">{r.current_period_end ? new Date(r.current_period_end).toLocaleDateString('he-IL') : '—'}</td>
                  <td className="px-3 py-2 text-end">
                    <div className="inline-flex items-center gap-2 flex-wrap">
                      <button onClick={() => extendTrial(r)} disabled={busy === r.id} className="inline-flex items-center gap-1 text-xs text-amber-700 hover:bg-amber-50 px-2 py-1 rounded disabled:opacity-50">
                        <Clock className="w-3.5 h-3.5" /> הארך ניסיון
                      </button>
                      <button onClick={() => grant(r)} disabled={busy === r.id} className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:bg-emerald-50 px-2 py-1 rounded disabled:opacity-50">
                        <Gift className="w-3.5 h-3.5" /> הענק
                      </button>
                      <button
                        onClick={() => convertToComped(r)}
                        disabled={busy === r.id || r.status === 'comped'}
                        title={r.status === 'comped' ? 'המנוי כבר פטור מחיוב' : 'העבר למנוי פעיל · ללא חיוב'}
                        className="inline-flex items-center gap-1 text-xs text-sky-700 hover:bg-sky-50 px-2 py-1 rounded disabled:opacity-50"
                      >
                        <HandCoins className="w-3.5 h-3.5" /> פטור מחיוב
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
