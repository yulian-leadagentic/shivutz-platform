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
import { FireworksOverlay } from '@/features/searches/FireworksOverlay';
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
  // Redirect-to-deals countdown after a successful match — fires
  // 6 s after the success screen appears (the user said "after the
  // fireworks") or immediately on click. Cleared if the user
  // unmounts / navigates earlier.
  const REDIRECT_AFTER_MS = 6000;
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
    // Block the second click BEFORE validation runs so a fast double-
    // submit can't create two worker_searches. Previously setSubmitting
    // was only flipped after validation passed, leaving a race window
    // where a double-click sent two POSTs and the search-creation
    // endpoint (no DB-level dedupe on contractor/profession/region/
    // start_date) accepted both, producing duplicate rows the corp
    // then saw as duplicate proposals.
    if (submitting) return;
    setSubmitting(true);
    setError('');
    setErrorField(null);
    if (quantity < 1) {
      setError('יש להזין כמות עובדים של לפחות 1');
      setErrorField('quantity');
      document.getElementById('field-quantity')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setSubmitting(false); // release the early-set lock so the user can fix + resubmit
      return;
    }
    if (!startDate) {
      setError('יש לבחור תאריך תחילת עבודה לפני המשך');
      setErrorField('startDate');
      const el = document.getElementById('field-startDate');
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus();
      setSubmitting(false);
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

    // (submitting was already flipped to true at the top of this
    // function — the redundant set used to live here.)
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

      // New flow: the system auto-broadcasts the request to every
      // matched corp. The contractor no longer manually selects
      // which corps to contact — they just wait for an SMS when
      // a corp commits workers. So fan out dealApi.create to every
      // returned corp in parallel; failures are non-fatal (a corp
      // might already have a deal for this search, etc.).
      if (m.length > 0) {
        await Promise.allSettled(
          m.map((c) => dealApi.create({
            search_id:      created.id,
            corporation_id: c.corporation_id,
          })),
        );
      }
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

  // After a successful match the next thing the contractor should
  // do is open /contractor/deals to track corp responses. Auto-
  // push them there 6 s after the success screen appears, OR
  // immediately on any click on the success card. The timer is
  // armed only once per success render and cleaned up if the
  // user navigates away first.
  useEffect(() => {
    if (matching) return;          // animation still running
    if (!corps || corps.length === 0) return;  // no match → don't redirect
    const t = setTimeout(() => router.push('/contractor/deals'), REDIRECT_AFTER_MS);
    return () => clearTimeout(t);
  }, [corps, matching, router]);

  function handleSuccessClick() {
    if (corps && corps.length > 0) router.push('/contractor/deals');
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

          {/* 3. Experience picker — collapsed per R2#6 to a binary
              "ללא ניסיון" / "עם ניסיון". Internally we still write
              into the same `expRanges` state so the matcher's
              min_experience floor logic in handleSubmit() works
              without changes: empty array → min 0 (no constraint),
              ['6+'] → min 6 months (anything past entry-level). The
              old 5-range UI confused contractors who weren't sure
              what bucket their needs fell into. */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              ניסיון
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
                ללא ניסיון
              </button>
              <button
                type="button"
                onClick={() => setExpRanges(['6-12'])}
                className={`text-xs px-3 py-1.5 rounded-full border transition ${
                  expRanges.length > 0
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-slate-700 border-slate-300 hover:border-brand-400'
                }`}
              >
                עם ניסיון
              </button>
            </div>
          </div>

          {/* 4 + 5 — start date + employment duration, side-by-side */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-baseline justify-between mb-1.5 gap-2">
                <label className="block text-xs font-semibold text-slate-700">
                  תאריך תחילת עבודה/העסקה <span className="text-red-500">*</span>
                </label>
                {/* R5 #7 — quick "immediate availability" checkbox.
                    Auto-fills today's date so the contractor doesn't
                    have to open the date picker for the common "I need
                    workers right now" case. Unchecking just leaves the
                    current value in place; the user can pick a date
                    manually if they un-toggle. */}
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!!startDate && startDate === new Date().toISOString().slice(0, 10)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setStartDate(new Date().toISOString().slice(0, 10));
                        if (errorField === 'startDate') { setError(''); setErrorField(null); }
                      }
                    }}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span>זמינות מיידית</span>
                </label>
              </div>
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

      {/* Post-match results.
          New flow: instead of listing every matched corp and asking
          the contractor to pick which to contact, the system auto-
          dispatches inquiries to every matched corp (see
          handleSubmit). The post-match screen just confirms what
          the system did and tells the contractor to wait for SMS.
          The brand video keeps looping so the screen still feels
          "alive". */}
      {corps !== null && !matching && (
        <section
          onClick={handleSuccessClick}
          className={`relative bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm text-center ${corps.length > 0 ? 'cursor-pointer' : ''}`}
          role={corps.length > 0 ? 'button' : undefined}
          aria-label={corps.length > 0 ? 'מעבר לבקשות ועסקאות' : undefined}
        >
          {/* Celebration overlay only on a successful match — keep
              the no-match screen calmer. */}
          {corps.length > 0 && <FireworksOverlay />}

          {/* Spinning brand video — z-20 keeps it above the
              fireworks overlay (z-10). A subtle white halo lifts
              it visually away from the fireworks behind. */}
          <video
            src="/brand/buildup-logo-spinning.mp4"
            poster="/brand/buildup-logo.png"
            autoPlay
            loop
            muted
            playsInline
            className="relative z-20 w-40 h-40 mx-auto object-contain rounded-full bg-white/90 shadow-lg shadow-white/60"
            aria-hidden="true"
          />

          {corps.length > 0 ? (
            <div className="relative z-20 mt-5 space-y-4 max-w-md mx-auto">
              <div>
                <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 leading-tight drop-shadow-sm">
                  {corps.length === 1
                    ? 'נמצאה התאמה לתאגיד אחד לפחות'
                    : `נמצאו התאמות ל-${corps.length} תאגידים`}
                </h2>
                <p className="text-sm font-semibold text-emerald-700 mt-2">
                  שלחנו פניה לכולם
                </p>
              </div>

              <div className="rounded-xl bg-emerald-50/95 border border-emerald-200 px-4 py-3 text-sm text-emerald-900 leading-relaxed backdrop-blur-sm">
                <p>ברגע שיאשרו זמינות עובדים נעדכן אותך בהודעת SMS / WhatsApp</p>
                <p className="text-emerald-700/80 mt-0.5">למספר ששמור במערכת</p>
              </div>

              <p className="text-sm text-slate-700 leading-relaxed bg-white/80 rounded-lg px-3 py-2 backdrop-blur-sm">
                אתה יכול לעקוב אחר התקדמות העסקה בתפריט{' '}
                <Link href="/contractor/deals" className="font-bold text-brand-600 hover:underline">
                  בקשות ועסקאות
                </Link>
              </p>
            </div>
          ) : (
            <div className="relative z-20 mt-5 space-y-4 max-w-md mx-auto">
              <div>
                <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 leading-tight">
                  לא נמצאו התאמות
                </h2>
                <p className="text-sm font-semibold text-slate-700 mt-2">
                  המערכת ממשיכה לחפש עבורך עובדים באופן אקטיבי
                </p>
              </div>

              <div className="rounded-xl bg-sky-50 border border-sky-200 px-4 py-3 text-sm text-sky-900 leading-relaxed">
                <p>תקבל עדכון ב-SMS / WhatsApp למספר ששמור במערכת ברגע שתימצא התאמה</p>
              </div>
            </div>
          )}

          <div className="relative z-20 mt-6 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/contractor/deals"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold px-5 py-2.5 shadow-sm shadow-emerald-200"
            >
              <LayoutDashboard className="w-4 h-4" />
              צפה בבקשות ועסקאות
            </Link>
            <Link
              href="/contractor/find"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold px-5 py-2.5"
            >
              <Plus className="w-4 h-4" />
              חיפוש נוסף
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}

