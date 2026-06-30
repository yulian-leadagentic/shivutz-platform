'use client';

// Pivot/v2 Phase 2 — corp's "my ads" list.
// Read-only listing of what this corp has published; each card has
// edit / boost / delete actions. Boost is currently free (sets
// featured_until = now+7d); paid promotion lands in Phase 5.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Plus, Pencil, Trash2, Zap, Eye } from 'lucide-react';
import { adApi, type AdRow } from '@/lib/api/ads';

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('he-IL');
}

function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000))) : null;
}

export default function CorporationAdsPage() {
  const [ads, setAds]         = useState<AdRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState<string | null>(null);
  const [error, setError]     = useState('');

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      setAds(await adApi.list());
    } catch (e) {
      setError((e as Error).message ?? 'שגיאה בטעינת המודעות');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function onBoost(id: string) {
    setBusy(id);
    try { await adApi.boost(id); await refresh(); }
    catch (e) { setError((e as Error).message ?? 'שגיאה בקידום'); }
    finally  { setBusy(null); }
  }

  async function onDelete(id: string) {
    if (!confirm('למחוק את המודעה?')) return;
    setBusy(id);
    try { await adApi.remove(id); await refresh(); }
    catch (e) { setError((e as Error).message ?? 'שגיאה במחיקה'); }
    finally  { setBusy(null); }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">המודעות שלי</h1>
          <p className="text-sm text-slate-500">פרסום זמינות עובדים, ובהמשך גם דיור (שלב 4)</p>
        </div>
        <Link
          href="/corporation/ads/new"
          className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2.5 rounded-lg"
        >
          <Plus className="w-4 h-4" />
          מודעה חדשה
        </Link>
      </header>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-16"><Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400" /></div>
      ) : ads.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500 shadow-sm">
          עוד לא פרסמת מודעות. לחץ "מודעה חדשה" כדי להתחיל.
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {ads.map((ad) => {
            const boosted = ad.featured_until && new Date(ad.featured_until) > new Date();
            return (
              <li key={ad.id} className={`rounded-2xl border p-4 shadow-sm bg-white ${boosted ? 'border-amber-300' : 'border-slate-200'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-slate-900 truncate">{ad.title_he}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {ad.ad_type === 'worker' ? 'מודעת עובדים' : 'מודעת דיור'}
                      {ad.quantity ? ` · ${ad.quantity} עובדים` : ''}
                      {ad.region ? ` · ${ad.region}` : ''}
                    </p>
                  </div>
                  {boosted && (
                    <span className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                      <Zap className="w-3 h-3" />
                      מקודם
                    </span>
                  )}
                </div>

                {ad.body_he && <p className="text-sm text-slate-700 mt-2 line-clamp-2">{ad.body_he}</p>}

                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-3 text-xs">
                  <div><dt className="text-slate-500">פג תוקף</dt><dd className="text-slate-800">{fmt(ad.expires_at)}{daysLeft(ad.expires_at) !== null ? ` (עוד ${daysLeft(ad.expires_at)} ימים)` : ''}</dd></div>
                  <div><dt className="text-slate-500">צפיות</dt><dd className="text-slate-800 inline-flex items-center gap-1"><Eye className="w-3 h-3" />{ad.view_count}</dd></div>
                </dl>

                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100">
                  <Link
                    href={`/corporation/ads/${ad.id}/edit`}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-brand-700 hover:bg-slate-100 px-2 py-1.5 rounded"
                  >
                    <Pencil className="w-3.5 h-3.5" /> ערוך
                  </Link>
                  <button
                    type="button"
                    onClick={() => onBoost(ad.id)}
                    disabled={busy === ad.id}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 px-2 py-1.5 rounded disabled:opacity-50"
                  >
                    <Zap className="w-3.5 h-3.5" /> {boosted ? 'הארך קידום' : 'קדם 7 ימים'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(ad.id)}
                    disabled={busy === ad.id}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 px-2 py-1.5 rounded disabled:opacity-50 ms-auto"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> מחק
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
