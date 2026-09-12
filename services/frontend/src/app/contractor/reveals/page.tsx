'use client';

// L7 · PRD-2 · contractor's own reveal history.
//
// Everything the contractor already paid to see, in one place: corp
// name, phone (tel:), email (mailto:), and the ad they clicked from.
// Viewing this page is NOT a reveal — it never calls /contact-reveal
// and never increments quota. A removed ad keeps the row (the
// contact was paid for, not the ad).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Download, RefreshCw, Phone, Mail, ChevronRight, Search } from 'lucide-react';
import { revealsApi, type ContractorReveal } from '@/lib/api/reveals';
import { mapApiError } from '@/lib/api/errors';

const AD_TYPE_LABEL: Record<string, string> = { worker: 'עובדים', housing: 'דיור' };

function fmtDateTime(iso: string): string {
  try { return new Date(iso).toLocaleString('he-IL'); } catch { return iso; }
}

export default function ContractorRevealsPage() {
  const [rows, setRows]     = useState<ContractorReveal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');
  const [q, setQ]           = useState('');
  const [from, setFrom]     = useState<string>('');
  const [to, setTo]         = useState<string>('');

  async function refresh() {
    setLoading(true); setError('');
    try {
      const p = await revealsApi.contractor({ q: q || undefined, from: from || undefined, to: to || undefined, limit: 200 });
      setRows(p.results);
    } catch (e) { setError(mapApiError(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5" dir="rtl">
      <header className="space-y-1">
        <Link href="/contractor/dashboard" className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700">
          <ChevronRight className="w-3 h-3 me-1" /> חזרה ללוח בקרה
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">היסטוריית פרטי קשר</h1>
        <p className="text-sm text-slate-500">
          כל התאגידים שחשפת. פרטי הקשר נשמרים כאן גם אחרי שהמודעה הוסרה.
          צפייה בעמוד הזה אינה חשיפה חדשה ולא נספרת במכסה.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-600 flex-1 min-w-[200px]">
          חיפוש (שם תאגיד או מודעה)
          <div className="relative mt-1">
            <Search className="w-4 h-4 absolute top-2.5 start-2 text-slate-400" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') refresh(); }}
                   placeholder="חפש בשם תאגיד או כותרת"
                   className="block w-full border border-slate-300 rounded ps-8 pe-2 py-1.5 text-sm" />
          </div>
        </label>
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
          href={`/api/contractor/reveals.csv${q ? `?q=${encodeURIComponent(q)}` : ''}`}
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
          <p className="text-slate-700 font-semibold">אין עדיין חשיפות</p>
          <p className="text-sm text-slate-500 mt-1">חפשו במודעות ולחצו &quot;הצג פרטים&quot; כדי לחשוף פרטי קשר של תאגידים.</p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs">
              <tr>
                <th className="text-start px-3 py-2 font-semibold">תאריך</th>
                <th className="text-start px-3 py-2 font-semibold">מודעה</th>
                <th className="text-start px-3 py-2 font-semibold">תאגיד</th>
                <th className="text-start px-3 py-2 font-semibold">פרטי קשר</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 tabular-nums text-slate-700 whitespace-nowrap">{fmtDateTime(r.revealed_at)}</td>
                  <td className="px-3 py-2">
                    <div className="text-slate-900 font-medium">{r.title_he}</div>
                    <div className="text-xs text-slate-500 flex items-center gap-1 flex-wrap">
                      <span>{AD_TYPE_LABEL[r.ad_type] || r.ad_type}</span>
                      {r.profession_code && <><span>·</span><span>{r.profession_code}</span></>}
                      {r.origin_country  && <><span>·</span><span>{r.origin_country}</span></>}
                      {r.region          && <><span>·</span><span>{r.region}</span></>}
                      {r.ad_removed && <span className="ms-1 text-[10px] uppercase tracking-wider bg-slate-200 text-slate-700 rounded px-1.5">מודעה הוסרה</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-900 font-medium">{r.company_name}</td>
                  <td className="px-3 py-2 text-slate-700">
                    <div className="flex flex-col gap-0.5">
                      {r.phone && (
                        <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline" dir="ltr">
                          <Phone className="w-3.5 h-3.5" /> {r.phone}
                        </a>
                      )}
                      {r.email && (
                        <a href={`mailto:${r.email}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline break-all">
                          <Mail className="w-3.5 h-3.5" /> {r.email}
                        </a>
                      )}
                      {!r.phone && !r.email && <span className="text-slate-400">—</span>}
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
