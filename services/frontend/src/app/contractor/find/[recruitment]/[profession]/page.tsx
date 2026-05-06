'use client';

// Wave 3 — Step 3: search form + match results.
//
// Required: quantity, start_date.
// Optional: end_date, region, min_experience, origin_preference,
//           required_languages.
//
// Submit creates a worker_search row, runs the matcher, displays
// CorpMatch results inline. Each CorpMatch row has a "send inquiry"
// CTA that creates a deal (existing flow).

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, Loader2, Search as SearchIcon } from 'lucide-react';
import { enumApi } from '@/lib/api/enums';
import { searchApi } from '@/lib/api/jobs';
import { dealApi } from '@/lib/api/deals';
import { getProfessionIcon } from '@/features/searches/professionIcons';
import type {
  CorpMatch,
  Profession,
  RecruitmentType,
} from '@/types';

const RECRUITMENT_LABELS: Record<RecruitmentType, string> = {
  domestic: 'מהארץ',
  foreign:  'מחו״ל',
};

export default function FindFormPage() {
  const { recruitment, profession } = useParams<{
    recruitment: RecruitmentType;
    profession: string;
  }>();
  const router = useRouter();

  // ── Reference data (professions, regions, origins) ─────────────────
  const [profs, setProfs] = useState<Profession[]>([]);
  const [regions, setRegions] = useState<{ code: string; name_he: string }[]>([]);
  const [origins, setOrigins] = useState<{ code: string; name_he: string }[]>([]);

  useEffect(() => {
    Promise.allSettled([
      enumApi.professions().then(setProfs),
      enumApi.regions().then(setRegions),
      enumApi.origins().then(setOrigins),
    ]);
  }, []);

  const profDef = useMemo(() => profs.find((p) => p.code === profession), [profs, profession]);
  const Icon = getProfessionIcon(profession);

  // ── Form state ────────────────────────────────────────────────────
  const [quantity, setQuantity] = useState<number>(1);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [region, setRegion] = useState<string>('');
  const [minExpYears, setMinExpYears] = useState<number>(0);
  const [originPref, setOriginPref] = useState<string[]>([]);

  // ── UI state ──────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [matching, setMatching] = useState(false);
  const [searchId, setSearchId] = useState<string | null>(null);
  const [corps, setCorps] = useState<CorpMatch[] | null>(null);
  const [error, setError] = useState<string>('');
  const [sentInquiry, setSentInquiry] = useState<Record<string, boolean>>({});

  function toggleOrigin(code: string) {
    setOriginPref((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (quantity < 1)        { setError('כמות חייבת להיות לפחות 1'); return; }
    if (!startDate)          { setError('יש לבחור תאריך התחלה'); return; }

    setSubmitting(true);
    try {
      const created = await searchApi.create({
        recruitment_type:   recruitment,
        profession_type:    profession,
        quantity,
        start_date:         startDate,
        end_date:           endDate || undefined,
        region:             region || undefined,
        min_experience:     minExpYears * 12,
        origin_preference:  originPref,
        required_languages: [],
      });
      setSearchId(created.id);

      setMatching(true);
      const m = await searchApi.match(created.id);
      setCorps(m);
    } catch (e) {
      setError((e as Error).message ?? 'שגיאה ביצירת החיפוש');
    } finally {
      setSubmitting(false);
      setMatching(false);
    }
  }

  async function handleSendInquiry(corpId: string) {
    if (!searchId || sentInquiry[corpId]) return;
    try {
      await dealApi.create({
        search_id:      searchId,
        corporation_id: corpId,
      });
      setSentInquiry((s) => ({ ...s, [corpId]: true }));
    } catch (e) {
      setError((e as Error).message ?? 'שגיאה בשליחת הפנייה');
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <header className="space-y-1">
        <Link
          href={`/contractor/find/${recruitment}`}
          className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
        >
          <ChevronRight className="w-3 h-3 ml-1" /> חזרה למקצועות
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-brand-50 flex items-center justify-center">
            <Icon className="w-6 h-6 text-brand-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              {profDef?.name_he ?? profession}
            </h1>
            <p className="text-xs text-slate-500">
              {RECRUITMENT_LABELS[recruitment]}
            </p>
          </div>
        </div>
      </header>

      {!corps && (
        <form onSubmit={handleSubmit} className="space-y-4 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">
                כמות עובדים <span className="text-red-500">*</span>
              </label>
              <input
                type="number" min={1} max={50}
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value || '1', 10))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">
                תאריך התחלה <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                required
              />
            </div>
          </div>

          <details className="border border-slate-200 rounded-lg p-3 bg-slate-50/50">
            <summary className="text-sm font-medium text-slate-700 cursor-pointer">
              שדות נוספים (רשות)
            </summary>
            <div className="grid grid-cols-2 gap-4 mt-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-600">תאריך סיום</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-600">אזור עבודה</label>
                <select
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none"
                >
                  <option value="">לא צויין</option>
                  {regions.map((r) => (
                    <option key={r.code} value={r.code}>{r.name_he}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1 col-span-2">
                <label className="text-xs font-semibold text-slate-600">מינימום ניסיון (שנים)</label>
                <input
                  type="number" min={0} max={30}
                  value={minExpYears}
                  onChange={(e) => setMinExpYears(parseInt(e.target.value || '0', 10))}
                  className="w-32 border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none"
                />
              </div>
              <div className="space-y-1 col-span-2">
                <label className="text-xs font-semibold text-slate-600">העדפת מדינות מוצא</label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {origins.map((o) => {
                    const active = originPref.includes(o.code);
                    return (
                      <button
                        type="button"
                        key={o.code}
                        onClick={() => toggleOrigin(o.code)}
                        className={`text-xs px-2.5 py-1 rounded-full border transition ${
                          active
                            ? 'bg-brand-600 text-white border-brand-600'
                            : 'bg-white text-slate-700 border-slate-300 hover:border-brand-400'
                        }`}
                      >
                        {o.name_he}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </details>

          {error && <div className="text-sm text-red-600">{error}</div>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-brand-600 hover:bg-brand-500 text-white font-semibold py-3 rounded-lg
                       disabled:bg-slate-400 inline-flex items-center justify-center gap-2 transition"
          >
            {submitting ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> שולח...</>
            ) : (
              <><SearchIcon className="w-4 h-4" /> חפש התאמות</>
            )}
          </button>
        </form>
      )}

      {(matching || corps) && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900">
            התאמות מתאגידים
          </h2>

          {matching && !corps && (
            <div className="text-center text-sm text-slate-500 py-12">
              <Loader2 className="w-5 h-5 animate-spin inline ml-2" />
              מחפש התאמות...
            </div>
          )}

          {corps && corps.length === 0 && (
            <div className="text-sm text-slate-600 bg-amber-50 border border-amber-200 rounded-lg p-4">
              לא נמצאו התאמות זמינות. נסה לרכך את התנאים או חזור מאוחר יותר.
            </div>
          )}

          {corps && corps.length > 0 && (
            <ul className="space-y-2">
              {corps.map((c) => (
                <li
                  key={c.corporation_id}
                  className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">
                      {c.corporation_name ?? 'תאגיד'}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {c.filled_workers}/{c.needed} עובדים זמינים
                      <span className="mx-1.5">•</span>
                      {Math.round(c.fill_percentage)}% מילוי
                    </div>
                  </div>
                  <button
                    onClick={() => handleSendInquiry(c.corporation_id)}
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

          {searchId && (
            <button
              onClick={() => router.push(`/contractor/searches/${searchId}`)}
              className="text-xs text-brand-600 hover:text-brand-500 font-medium"
            >
              עבור לעמוד החיפוש המלא →
            </button>
          )}
        </section>
      )}
    </div>
  );
}
