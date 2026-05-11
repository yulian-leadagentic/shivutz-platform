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
  // code → Hebrew name lookup for the origin breakdown shown on each
  // match card. Origins are also available via EnumsContext but the
  // local `origins` state is already populated here, so we just memo
  // it into a map.
  const originMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const o of origins) m[o.code] = o.name_he;
    return m;
  }, [origins]);

  // ── Form state ────────────────────────────────────────────────────
  const [quantity, setQuantity]       = useState<number>(1);
  const [originPref, setOriginPref]   = useState<string[]>([]);
  const [expRanges, setExpRanges]     = useState<string[]>([]); // multi-select
  const [startDate, setStartDate]     = useState<string>('');
  const [durationCode, setDurationCode] = useState<string>('3');
  const [region, setRegion]           = useState<string>('');

  // ── UI state ──────────────────────────────────────────────────────
  const [submitting, setSubmitting]   = useState(false);
  const [matching, setMatching]       = useState(false);
  const [searchId, setSearchId]       = useState<string | null>(null);
  const [corps, setCorps]             = useState<CorpMatch[] | null>(null);
  const [error, setError]             = useState<string>('');
  // `errorField` is the form field that triggered the current error, if
  // any. Used to highlight the offending input + scroll it into view.
  const [errorField, setErrorField]   = useState<'quantity' | 'startDate' | null>(null);
  const [sentInquiry, setSentInquiry] = useState<Record<string, boolean>>({});

  function toggleOrigin(code: string) {
    setOriginPref((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  }

  function toggleExpRange(code: string) {
    setExpRanges((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setErrorField(null);
    if (quantity < 1) {
      setError('יש להזין כמות עובדים של לפחות 1');
      setErrorField('quantity');
      document.getElementById('field-quantity')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (!startDate) {
      setError('יש לבחור תאריך תחילת עבודה לפני המשך');
      setErrorField('startDate');
      const el = document.getElementById('field-startDate');
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus();
      return;
    }

    const months = parseInt(durationCode, 10) || 3;
    const endDate = addMonths(startDate, months);
    // Multi-select: take the LOWEST lower-bound across all selected
    // ranges as the matcher's `min_experience`. The matcher only knows
    // about a single floor today, so multi-select is interpreted as
    // "any of these or higher" — looser than single-select.
    const minExp  = expRanges.length === 0
      ? 0
      : Math.min(...expRanges.map((r) => EXPERIENCE_LOWER_MONTHS[r] ?? 0));

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
          noValidate
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
              id="field-quantity"
              type="number" min={1}
              value={quantity}
              onChange={(e) => {
                setQuantity(parseInt(e.target.value || '1', 10));
                if (errorField === 'quantity') { setError(''); setErrorField(null); }
              }}
              className={`w-32 border rounded-lg px-3 py-2 text-sm outline-none
                         focus:ring-1 ${
                           errorField === 'quantity'
                             ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                             : 'border-slate-300 focus:border-brand-500 focus:ring-brand-500'
                         }`}
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

          {/* 3. Experience range pills — multi-select */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              ניסיון <span className="text-[10px] font-normal text-slate-500">(אפשר לבחור כמה)</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setExpRanges([])}
                className={`text-xs px-3 py-1.5 rounded-full border transition ${
                  expRanges.length === 0
                    ? 'bg-slate-700 text-white border-slate-700'
                    : 'bg-white text-slate-700 border-slate-300 hover:border-brand-400'
                }`}
              >
                ללא הגבלה
              </button>
              {EXPERIENCE_RANGES.map((r) => {
                const active = expRanges.includes(r.code);
                return (
                  <button
                    type="button"
                    key={r.code}
                    onClick={() => toggleExpRange(r.code)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition ${
                      active
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-white text-slate-700 border-slate-300 hover:border-brand-400'
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4 + 5 — start date + employment duration, side-by-side */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                תאריך תחילת עבודה <span className="text-red-500">*</span>
              </label>
              <input
                id="field-startDate"
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (errorField === 'startDate') { setError(''); setErrorField(null); }
                }}
                className={`w-full border rounded-lg px-3 py-2 text-sm outline-none
                           focus:ring-1 ${
                             errorField === 'startDate'
                               ? 'border-red-500 focus:border-red-500 focus:ring-red-500 bg-red-50/40'
                               : 'border-slate-300 focus:border-brand-500 focus:ring-brand-500'
                           }`}
              />
              {errorField === 'startDate' && (
                <p className="text-xs text-red-600 mt-1.5">{error}</p>
              )}
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

          {/* Global error block — for API errors and the quantity field
              (date errors render inline next to the date field). */}
          {error && errorField !== 'startDate' && (
            <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <span aria-hidden>⚠️</span>
              <span>{error}</span>
            </div>
          )}

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

      {corps && corps.length === 0 && (
        <div className="space-y-4">
          <div className="text-sm text-slate-700 bg-sky-50 border border-sky-200 rounded-lg p-4">
            לא נמצאו התאמות זמינות. המערכת תמשיך לחפש התאמות ותעדכן אותך בהקדם — בנוסף שלחנו עכשיו הודעה לתאגידים רלוונטיים כדי שיעלו עובדים מתאימים.
          </div>
          {/* CTAs so the user doesn't dead-end on the no-match screen */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link
              href="/contractor/find"
              className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:border-brand-500 hover:bg-brand-50/30 transition shadow-sm"
            >
              <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
                <Plus className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-900">התחל חיפוש חדש</div>
                <div className="text-xs text-slate-500">בחר מקצוע אחר או שנה את הפרמטרים</div>
              </div>
            </Link>
            <Link
              href="/contractor/deals"
              className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:border-brand-500 hover:bg-brand-50/30 transition shadow-sm"
            >
              <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                <LayoutDashboard className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-900">צפייה בהצעות שלי</div>
                <div className="text-xs text-slate-500">כל הבקשות והעסקאות הפעילות</div>
              </div>
            </Link>
          </div>
        </div>
      )}

      {corps && corps.length > 0 && (
        <section className="space-y-4">
          {/* WOW celebratory header — emerald gradient with sparkle + count */}
          <div className="relative overflow-hidden rounded-2xl
                          bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-600
                          text-white p-5 shadow-lg">
            <div className="absolute -top-6 -end-6 w-32 h-32 bg-white/10 rounded-full blur-2xl" />
            <div className="absolute -bottom-8 -start-4 w-24 h-24 bg-white/10 rounded-full blur-2xl" />
            <div className="relative flex items-center gap-3">
              <div className="text-3xl drop-shadow-sm" aria-hidden>🎉</div>
              <div>
                <div className="text-lg font-bold leading-tight">
                  מצאנו {corps.length} {corps.length === 1 ? 'התאמה' : 'התאמות'} עבורך
                </div>
                <div className="text-sm text-emerald-50/90 mt-0.5">
                  לחץ &quot;צור קשר עם התאגיד&quot; ליד התאגיד שמתאים לך
                </div>
              </div>
            </div>
          </div>

          <ul className="space-y-3">
            {corps.map((c, idx) => {
              const isTop = idx === 0;
              // Anonymize: show "תאגיד 1" / "תאגיד 2" etc. The real
              // company name is only revealed AFTER the contractor
              // sends an inquiry and the corp accepts. This keeps a
              // level playing field across corps and protects names
              // from being scraped.
              const anonymousLabel = `תאגיד ${idx + 1}`;
              // Origin distribution for this corp's matched workers —
              // a quick "PH×3, RO×1" breakdown keeps the contractor
              // from having to drill in to see where the workers come
              // from.
              const originCounts = c.workers.reduce<Record<string, number>>(
                (acc, w) => {
                  const code = w.worker.origin_country || '?';
                  acc[code] = (acc[code] ?? 0) + 1;
                  return acc;
                },
                {},
              );
              const originSummary = Object.entries(originCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([code, n]) => `${originMap[code] ?? code} ×${n}`)
                .join(' · ');
              return (
                <li
                  key={c.corporation_id}
                  className={`relative bg-white rounded-2xl p-5 sm:p-6 shadow-sm
                              ${isTop
                                ? 'border-2 border-emerald-400 ring-4 ring-emerald-100'
                                : 'border border-slate-200'}`}
                >
                  {isTop && (
                    <div className="absolute -top-2.5 end-4 inline-flex items-center gap-1
                                    bg-emerald-500 text-white text-[10px] font-bold
                                    uppercase tracking-wide px-2.5 py-1 rounded-full
                                    shadow-md">
                      ⭐ ההתאמה הטובה ביותר
                    </div>
                  )}
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="min-w-0 flex-1 space-y-3">
                      {/* Anonymized corp label */}
                      <div className="font-bold text-slate-900 text-base">
                        {anonymousLabel}
                      </div>
                      {/* Big number row — workers found + match% */}
                      <div className="flex items-end gap-6">
                        <div>
                          <div className="text-3xl sm:text-4xl font-extrabold text-slate-900 leading-none">
                            {c.filled_workers}
                            <span className="text-lg sm:text-xl text-slate-400 font-bold mx-1">/</span>
                            <span className="text-xl sm:text-2xl text-slate-500 font-bold">{c.needed}</span>
                          </div>
                          <div className="text-xs text-slate-500 mt-1.5">עובדים נמצאו</div>
                        </div>
                        <div>
                          <div className={`text-3xl sm:text-4xl font-extrabold leading-none ${c.is_complete ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {Math.round(c.fill_percentage)}%
                          </div>
                          <div className="text-xs text-slate-500 mt-1.5">התאמה</div>
                        </div>
                      </div>
                      {/* Worker origin breakdown — "פיליפינים ×3 · רומניה ×1" */}
                      {originSummary && (
                        <div className="text-sm text-slate-700 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                          <span className="text-[10px] uppercase tracking-widest text-slate-400 me-2">מוצא העובדים</span>
                          <span className="font-medium">{originSummary}</span>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleSendInquiry(c.corporation_id)}
                      disabled={!!sentInquiry[c.corporation_id]}
                      className={`px-5 py-3 rounded-lg whitespace-nowrap font-bold text-sm
                                  transition shrink-0 ${
                        sentInquiry[c.corporation_id]
                          ? 'bg-emerald-100 text-emerald-700 cursor-default'
                          : isTop
                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md hover:shadow-lg animate-pulse'
                            : 'bg-brand-600 hover:bg-brand-500 text-white'
                      }`}
                    >
                      {sentInquiry[c.corporation_id] ? '✓ נשלח לתאגיד' : 'צור קשר עם התאגיד'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Post-results "what next" tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <Link
              href={`/contractor/find/${recruitment}`}
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

