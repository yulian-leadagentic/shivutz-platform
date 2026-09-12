'use client';

// L7 · PRD-1 · corp view of contact_reveals.
//
// The corp sees WHAT happened to its ads — never WHO did it. The
// backend does not select any contractor identity fields (see
// services/user-org/app/routes/reveals.py), so there is nothing to
// hide client-side and nothing to leak here.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Download, RefreshCw, ChevronRight } from 'lucide-react';
import { revealsApi, type CorpReveal } from '@/lib/api/reveals';
import { mapApiError } from '@/lib/api/errors';

const AD_TYPE_LABEL: Record<string, string> = { worker: 'עובדים', housing: 'דיור' };

function fmtDateTime(iso: string): string {
  try { return new Date(iso).toLocaleString('he-IL'); } catch { return iso; }
}

export default function CorporationRevealsPage() {
  const [rows, setRows]     = useState<CorpReveal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');
  const [from, setFrom]     = useState<string>('');
  const [to, setTo]         = useState<string>('');

  async function refresh() {
    setLoading(true); setError('');
    try {
      const p = await revealsApi.corp({ from: from || undefined, to: to || undefined, limit: 200 });
      setRows(p.results);
    } catch (e) { setError(mapApiError(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5" dir="rtl">
      <header className="space-y-1">
        <Link href="/corporation/dashboard" className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700">
          <ChevronRight className="w-3 h-3 me-1" /> חזרה ללוח בקרה
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">חשיפות פרטי קשר</h1>
        <p className="text-sm text-slate-500">
          קבלנים שחשפו את פרטי הקשר של המודעות שלכם. אנחנו לא מציגים את זהות הקבלן —
          רק את המודעה שנחשפה, המקצוע ותאריך החשיפה.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-600">
          מתאריך
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                 className="mt-1 block border border-slate-300 rounded px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-slate-600">
          עד תאריך
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                 className="mt-1 block border border-slate-300 rounded px-2 py-1.5 text-sm" />
        </label>
        <button type="button" onClick={refresh}
                className="h-9 inline-flex items-center gap-1 text-sm font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded px-3">
          <RefreshCw className="w-4 h-4" /> החל
        </button>
        <a
          href={`/api/ads/mine/reveals.csv${from ? `?from=${from}` : ''}${to ? `${from ? '&' : '?'}to=${to}` : ''}`}
          className="h-9 inline-flex items-center gap-1 text-sm font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded px-3"
        >
          <Download className="w-4 h-4" /> ייצא CSV
        </a>
      </div>

      {error && (
        <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-16"><Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400" /></div>
      ) : rows.length === 0 ? (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-8 text-center">
          <p className="text-slate-700 font-semibold">עדיין לא נחשפו פרטי קשר על המודעות שלך</p>
          <p className="text-sm text-slate-500 mt-1">מודעה מקודמת מגדילה חשיפה.</p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs">
              <tr>
                <th className="text-start px-3 py-2 font-semibold">תאריך</th>
                <th className="text-start px-3 py-2 font-semibold">מודעה</th>
                <th className="text-start px-3 py-2 font-semibold">סוג</th>
                <th className="text-start px-3 py-2 font-semibold">מקצוע</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 tabular-nums text-slate-700">{fmtDateTime(r.revealed_at)}</td>
                  <td className="px-3 py-2 text-slate-900">{r.title_he}</td>
                  <td className="px-3 py-2 text-slate-600">{AD_TYPE_LABEL[r.ad_type] || r.ad_type}</td>
                  <td className="px-3 py-2 text-slate-600">{r.profession_code || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
