'use client';

// Wave 4 (2026-05-07) — search form simplified per UX feedback:
//
// Form is FLAT (no collapsible "advanced" section). Field order is the
// order users actually think about it:
//   1. כמות עובדים        (required)
//   2. ארץ מוצא          (multi-select pills, optional)
//   3. ניסיון            (range pills, optional, like the worker form)
//   4. תאריך תחילת עבודה  (required)
//   5. זמן תעסוקה        (duration pills — auto-derives end_date)
//   6. אזור עבודה         (optional, dropdown — kept tucked since most
//                        contractors leave it blank)

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronRight, Loader2, Search as SearchIcon, Sparkles,
  LayoutDashboard, Plus,
} from 'lucide-react';
import { enumApi } from '@/lib/api/enums';
import { searchApi } from '@/lib/api/jobs';
import { dealApi } from '@/lib/api/deals';
import { ProfessionIcon } from '@/features/searches/ProfessionIcon';
import { ConstructionAnimation } from '@/features/searches/ConstructionAnimation';
import { EXPERIENCE_RANGES, EXPERIENCE_LOWER_MONTHS } from '@/i18n/he';
import type {
  CorpMatch,
  Profession,
  RecruitmentType,
} from '@/types';

const RECRUITMENT_LABELS: Record<RecruitmentType, string> = {
  domestic: 'מהארץ',
  foreign:  'מחו״ל',
};

// Employment-duration pill options. End date is computed as
// start_date + duration_months.
const DURATIONS = [
  { code: '1',   label: 'חודש' },
  { code: '3',   label: '3 חודשים' },
  { code: '6',   label: '6 חודשים' },
  { code: '12',  label: 'שנה' },
  { code: '24',  label: 'שנתיים+' },
] as const;

function addMonths(iso: string, months: number): string {
  if (!iso) return '';
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export default function FindFormPage() {
  const { recruitment, profession } = useParams<{
    recruitment: RecruitmentType;
    profession: string;
  }>();
  const router = useRouter();

  // ── Reference data ────────────────────────────────────────────────
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

  // ── Form state ────────────────────────────────────────────────────
  const [quantity, setQuantity]       = useState<number>(1);
  const [originPref, setOriginPref]   = useState<string[]>([]);
  const [expRange, setExpRange]       = useState<string>(''); // '' | '0-6' | …
  const [startDate, setStartDate]     = useState<string>('');
  const [durationCode, setDurationCode] = useState<string>('3');
  const [region, setRegion]           = useState<string>('');

  // ── UI state ──────────────────────────────────────────────────────
  const [submitting, setSubmitting]   = useState(false);
  const [matching, setMatching]       = useState(false);
  const [searchId, setSearchId]       = useState<string | null>(null);
  const [corps, setCorps]             = useState<CorpMatch[] | null>(null);
  const [error, setError]             = useState<string>('');
  const [sentInquiry, setSentInquiry] = useState<Record<string, boolean>>({});

  function toggleOrigin(code: string) {
    setOriginPref((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (quantity < 1) { setError('כמות חייבת להיות לפחות 1'); return; }
    if (!startDate)   { setError('יש לבחור תאריך התחלה'); return; }

    const months = parseInt(durationCode, 10) || 3;
    const endDate = addMonths(startDate, months);
    const minExp  = expRange ? (EXPERIENCE_LOWER_MONTHS[expRange] ?? 0) : 0;

    setSubmitting(true);
    try {
      const created = await searchApi.create({
        recruitment_type:   recruitment,
        profession_type:    profession,
        quantity,
        start_date:         startDate,
        end_date:           endDate || undefined,
        region:             region || undefined,
        min_experience:     minExp,
        origin_preference:  originPref,
        required_languages: [],
      });
      setSearchId(created.id);
      setSubmitting(false);

      // Show the matching animation for AT LEAST 5 seconds even if the
      // matcher returns sooner — gives the user a moment to see what's
      // happening + sells the AI-search story.
      setMatching(true);
      const minDelay = new Promise((r) => setTimeout(r, 5000));
      const [m] = await Promise.all([
        searchApi.match(created.id),
        minDelay,
      ]);
      setCorps(m);
    } catch (e) {
      setError((e as Error).message ?? 'שגיאה ביצירת החיפוש');
      setSubmitting(false);
    } finally {
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
          <ProfessionIcon code={profession} size={56} alt={profDef?.name_he} />
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

      {!corps && !matching && (
        <form
          onSubmit={handleSubmit}
          className="space-y-5 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm"
        >
          {/* AI hint banner */}
          <div className="flex items-start gap-2 bg-brand-50/60 border border-brand-100 rounded-lg px-3 py-2.5">
            <Sparkles className="w-4 h-4 text-brand-600 shrink-0 mt-0.5" />
            <p className="text-xs text-slate-700 leading-relaxed">
              ככל שתספק יותר פרטים, מנוע ה-AI שלנו יימצא התאמה יותר מדויקת
            </p>
          </div>

          {/* 1. Quantity */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              כמות עובדים <span className="text-red-500">*</span>
            </label>
            <input
              type="number" min={1} max={50}
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value || '1', 10))}
              className="w-32 border border-slate-300 rounded-lg px-3 py-2 text-sm
                         focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              required
            />
          </div>

          {/* 2. Country of origin (first per spec) */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">ארץ מוצא</label>
            <div className="flex flex-wrap gap-1.5">
              {origins.map((o) => {
                const active = originPref.includes(o.code);
                return (
                  <button
                    type="button"
                    key={o.code}
                    onClick={() => toggleOrigin(o.code)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition ${
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

          {/* 3. Experience range pills */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">ניסיון</label>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setExpRange('')}
                className={`text-xs px-3 py-1.5 rounded-full border transition ${
                  expRange === ''
                    ? 'bg-slate-700 text-white border-slate-700'
                    : 'bg-white text-slate-700 border-slate-300 hover:border-brand-400'
                }`}
              >
                ללא הגבלה
              </button>
              {EXPERIENCE_RANGES.map((r) => (
                <button
                  type="button"
                  key={r.code}
                  onClick={() => setExpRange(r.code)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition ${
                    expRange === r.code
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-white text-slate-700 border-slate-300 hover:border-brand-400'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* 4 + 5 — start date + employment duration, side-by-side */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                תאריך תחילת עבודה <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm
                           focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">זמן תעסוקה</label>
              <div className="flex flex-wrap gap-1.5">
                {DURATIONS.map((d) => (
                  <button
                    type="button"
                    key={d.code}
                    onClick={() => setDurationCode(d.code)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition ${
                      durationCode === d.code
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-white text-slate-700 border-slate-300 hover:border-brand-400'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 6. Region (last — least common to set) */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">אזור עבודה</label>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="w-full sm:w-64 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none"
            >
              <option value="">לא צויין</option>
              {regions.map((r) => (
                <option key={r.code} value={r.code}>{r.name_he}</option>
              ))}
            </select>
          </div>

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

      {/* Matching animation — shown for ≥5 seconds (see handleSubmit) */}
      {matching && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <ConstructionAnimation />
        </div>
      )}

      {corps && (
        <section className="space-y-4">
          <h2 className="text-lg font-bold text-slate-900">התאמות מתאגידים</h2>

          {corps.length === 0 && (
            <div className="text-sm text-slate-600 bg-amber-50 border border-amber-200 rounded-lg p-4">
              לא נמצאו התאמות זמינות. נסה לרכך את התנאים או חזור מאוחר יותר.
            </div>
          )}

          {corps.length > 0 && (
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
                    {sentInquiry[c.corporation_id] ? '✓ פנייה נשלחה' : 'שלח פנייה'}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Post-results "what next" tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <Link
              href="/contractor/find"
              className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white
                         p-4 hover:border-brand-500 hover:bg-brand-50/30 transition shadow-sm"
            >
              <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
                <Plus className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-900">חיפוש נוסף</div>
                <div className="text-xs text-slate-500">חזרה לבחירת מקצוע</div>
              </div>
            </Link>
            <Link
              href="/contractor/dashboard"
              className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white
                         p-4 hover:border-brand-500 hover:bg-brand-50/30 transition shadow-sm"
            >
              <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                <LayoutDashboard className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-900">לוח בקרה</div>
                <div className="text-xs text-slate-500">סקירת המצב הכללי</div>
              </div>
            </Link>
          </div>

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

