'use client';

// Wave 3 — single worker_search detail.
// Shows the search parameters + cached match results + send-inquiry CTAs.
// Replaces /contractor/requests/[id]/match.

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { searchApi } from '@/lib/api/jobs';
import { dealApi } from '@/lib/api/deals';
import { enumApi } from '@/lib/api/enums';
import { getProfessionIcon } from '@/features/searches/professionIcons';
import type { CorpMatch, Profession, WorkerSearch } from '@/types';

export default function SearchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [search, setSearch]   = useState<WorkerSearch | null>(null);
  const [corps, setCorps]     = useState<CorpMatch[] | null>(null);
  const [matching, setMatch]  = useState(false);
  const [profDef, setProfDef] = useState<Profession | null>(null);
  const [sentInquiry, setSentInquiry] = useState<Record<string, boolean>>({});
  const [error, setError]     = useState<string>('');

  useEffect(() => {
    if (!id) return;
    Promise.allSettled([
      searchApi.get(id).then(setSearch),
      searchApi.matchResults(id).then((c) => setCorps(c)),
      enumApi.professions().then((ps) => {
        const cur = ps.find((p) => p.code === search?.profession_type);
        if (cur) setProfDef(cur);
      }),
    ]);
  }, [id, search?.profession_type]);

  // Hydrate corp names if cache returned them without names.
  useEffect(() => {
    if (!corps || !corps.length) return;
    if (corps[0].corporation_name) return;
    Promise.allSettled(corps.map(async (c) => {
      try {
        // Re-running match also hydrates names, but that costs a roundtrip.
        // For simplicity here we just mark them with the ID until /match runs.
      } catch {}
    }));
  }, [corps]);

  async function rematch() {
    if (!id) return;
    setMatch(true);
    setError('');
    try {
      const res = await searchApi.match(id);
      setCorps(res);
    } catch (e) {
      setError((e as Error).message ?? 'שגיאה בהרצת התאמות');
    } finally {
      setMatch(false);
    }
  }

  async function sendInquiry(corpId: string) {
    if (!id || sentInquiry[corpId]) return;
    try {
      await dealApi.create({ search_id: id, corporation_id: corpId });
      setSentInquiry((s) => ({ ...s, [corpId]: true }));
    } catch (e) {
      setError((e as Error).message ?? 'שגיאה בשליחת הפנייה');
    }
  }

  if (!search) {
    return <div className="text-center text-sm text-slate-500 py-12">טוען...</div>;
  }

  const Icon = getProfessionIcon(search.profession_type);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <header className="space-y-2">
        <Link href="/contractor/searches" className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700">
          <ChevronRight className="w-3 h-3 ml-1" /> חזרה לחיפושים שלי
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-brand-50 flex items-center justify-center">
            <Icon className="w-6 h-6 text-brand-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              {profDef?.name_he ?? search.profession_type}
            </h1>
            <p className="text-xs text-slate-500">
              {search.quantity} עובדים • התחלה {search.start_date}
              {search.region ? ` • אזור ${search.region}` : ''}
              {search.recruitment_type === 'foreign' ? ' • ייבוא' : ' • מהארץ'}
            </p>
          </div>
        </div>
      </header>

      <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">התאמות מתאגידים</h2>
          <button
            onClick={rematch}
            disabled={matching}
            className="text-xs text-brand-600 hover:text-brand-500 font-medium inline-flex items-center gap-1.5 disabled:text-slate-400"
          >
            {matching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            רענן התאמות
          </button>
        </div>

        {error && <div className="text-sm text-red-600">{error}</div>}

        {!corps && !matching && (
          <div className="text-sm text-slate-500 text-center py-6">
            עדיין לא הורצו התאמות. לחץ &quot;רענן התאמות&quot;.
          </div>
        )}

        {matching && (
          <div className="text-sm text-slate-500 text-center py-6">
            <Loader2 className="w-5 h-5 animate-spin inline ml-2" /> מחפש התאמות...
          </div>
        )}

        {corps && corps.length === 0 && (
          <div className="text-sm text-slate-600 bg-amber-50 border border-amber-200 rounded-lg p-4">
            לא נמצאו התאמות זמינות.
          </div>
        )}

        {corps && corps.length > 0 && (
          <ul className="space-y-2">
            {corps.map((c) => (
              <li
                key={c.corporation_id}
                className="border border-slate-200 rounded-xl p-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 text-sm truncate">
                    {c.corporation_name ?? c.corporation_id.slice(0, 8)}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {c.filled_workers}/{c.needed} עובדים
                    <span className="mx-1.5">•</span>
                    {Math.round(c.fill_percentage)}% מילוי
                  </div>
                </div>
                <button
                  onClick={() => sendInquiry(c.corporation_id)}
                  disabled={!!sentInquiry[c.corporation_id]}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap transition ${
                    sentInquiry[c.corporation_id]
                      ? 'bg-emerald-100 text-emerald-700 cursor-default'
                      : 'bg-brand-600 hover:bg-brand-500 text-white'
                  }`}
                >
                  {sentInquiry[c.corporation_id] ? 'נשלח ✓' : 'שלח פנייה'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
