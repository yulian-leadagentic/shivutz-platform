'use client';

// Pivot/v2 admin — ad moderation table.

import { useEffect, useState } from 'react';
import { EyeOff, Eye, Trash2, Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import { TableToolbar } from '@/components/table/TableToolbar';

interface AdminAdRow {
  id: string;
  owner_entity_id: string;
  owner_name: string | null;
  ad_type: 'worker' | 'housing';
  title_he: string;
  body_he: string | null;
  active: boolean;
  featured_until: string | null;
  view_count: number;
  created_at: string;
  deleted_at: string | null;
}

const AD_TYPE_LABEL: Record<string, string> = { worker: 'עובדים', housing: 'דיור' };

export default function AdminAdsPage() {
  const [ads, setAds]         = useState<AdminAdRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState<string | null>(null);
  const [error, setError]     = useState('');
  const [q, setQ]             = useState('');
  const [typeFilter, setType] = useState<'' | 'worker' | 'housing'>('');
  const [showHidden, setHid]  = useState(false);

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (typeFilter) params.set('ad_type', typeFilter);
      if (showHidden) params.set('hidden', 'true');
      if (q.trim())   params.set('q', q.trim());
      const rows = await apiFetch<AdminAdRow[]>(`/admin/ads?${params.toString()}`);
      setAds(rows);
    } catch (e) {
      setError((e as Error).message ?? 'שגיאה בטעינה');
    } finally { setLoading(false); }
  }

  useEffect(() => { refresh(); }, [typeFilter, showHidden]);

  async function toggle(row: AdminAdRow) {
    setBusy(row.id);
    try {
      await apiFetch(`/admin/ads/${row.id}/${row.active ? 'hide' : 'unhide'}`, { method: 'POST' });
      await refresh();
    } catch (e) { setError((e as Error).message ?? ''); }
    finally { setBusy(null); }
  }

  async function del(row: AdminAdRow) {
    if (!confirm(`למחוק את "${row.title_he}"?`)) return;
    setBusy(row.id);
    try {
      await apiFetch(`/admin/ads/${row.id}`, { method: 'DELETE' });
      await refresh();
    } catch (e) { setError((e as Error).message ?? ''); }
    finally { setBusy(null); }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">מודעות בפלטפורמה</h1>
        <p className="text-sm text-slate-500">ניהול תוכן — הסתרה, ביטול הסתרה, מחיקה</p>
      </header>

      {/* A1 — shared TableToolbar. Type filter as pills (better tap
          target on mobile than a select), 'הכל / עובדים / דיור'; hidden
          toggle as a checkbox trailing the search. */}
      <TableToolbar
        pills={{
          options: [
            { key: '',        label: 'הכל',    tone: 'bg-slate-900 text-white' },
            { key: 'worker',  label: 'עובדים', tone: 'bg-sky-500 text-white' },
            { key: 'housing', label: 'דיור',   tone: 'bg-emerald-500 text-white' },
          ],
          active: typeFilter,
          onChange: (v) => setType(v as '' | 'worker' | 'housing'),
        }}
        searchValue={q}
        onSearchChange={setQ}
        searchPlaceholder="חיפוש בכותרת/תיאור"
        onSearchSubmit={refresh}
        hasActiveFilter={typeFilter !== '' || showHidden || q.trim() !== ''}
        onClear={() => { setType(''); setHid(false); setQ(''); }}
        trailingControls={
          <label className="text-xs text-slate-600 inline-flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={showHidden} onChange={(e) => setHid(e.target.checked)} className="rounded" />
            כולל מחוקים
          </label>
        }
      />
      {/* No sort options here — admin ad list default sort is
          created_at DESC (server-side). Add sort if a real use-case
          emerges. */}

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-16"><Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400" /></div>
      ) : ads.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500">
          לא נמצאו מודעות
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 uppercase">
              <tr>
                <th className="text-start px-3 py-2">כותרת</th>
                <th className="text-start px-3 py-2">תאגיד</th>
                <th className="text-start px-3 py-2">סוג</th>
                <th className="text-start px-3 py-2">סטטוס</th>
                <th className="text-start px-3 py-2">צפיות</th>
                <th className="text-start px-3 py-2">נוצר</th>
                <th className="text-end px-3 py-2">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {ads.map((ad) => {
                const hidden = !!ad.deleted_at;
                return (
                  <tr key={ad.id} className={`border-b border-slate-100 ${hidden ? 'opacity-50' : ''}`}>
                    <td className="px-3 py-2 max-w-xs truncate font-medium text-slate-900">{ad.title_he}</td>
                    <td className="px-3 py-2 text-slate-600">{ad.owner_name || '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{AD_TYPE_LABEL[ad.ad_type]}</td>
                    <td className="px-3 py-2">
                      {hidden
                        ? <span className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">מחוק</span>
                        : ad.active
                          ? <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">פעיל</span>
                          : <span className="text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">מוסתר</span>
                      }
                    </td>
                    <td className="px-3 py-2 text-slate-600">{ad.view_count}</td>
                    <td className="px-3 py-2 text-slate-500 text-xs">{new Date(ad.created_at).toLocaleDateString('he-IL')}</td>
                    <td className="px-3 py-2 text-end">
                      {!hidden && (
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggle(ad)}
                            disabled={busy === ad.id}
                            className="inline-flex items-center gap-1 text-xs text-slate-700 hover:bg-slate-100 px-2 py-1 rounded disabled:opacity-50"
                          >
                            {ad.active ? <><EyeOff className="w-3.5 h-3.5" /> הסתר</> : <><Eye className="w-3.5 h-3.5" /> הצג</>}
                          </button>
                          <button
                            type="button"
                            onClick={() => del(ad)}
                            disabled={busy === ad.id}
                            className="inline-flex items-center gap-1 text-xs text-red-700 hover:bg-red-50 px-2 py-1 rounded disabled:opacity-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> מחק
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
