'use client';

// Trial search form — public counterpart of
// /contractor/find/[recruitment]/[profession]/page.tsx but without
// the real /searches POST + matcher fan-out. The prospect fills the
// form, we stash it in sessionStorage, and route to the match-preview
// gate which holds the user at the registration door.
//
// The full production form is ~540 lines of matcher + corp fan-out +
// success animation. This trial version keeps the SHAPE of that form
// (same fields, same order) but strips the post-submit behaviour to a
// simple sessionStorage write + redirect. Registration then replays
// the stash against the real /searches endpoint, so the prospect
// lands in /contractor/deals with a live search already running.

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, Loader2, Search as SearchIcon, Sparkles } from 'lucide-react';
import { enumApi } from '@/lib/api/enums';
import { ProfessionIcon } from '@/features/searches/ProfessionIcon';
import { EXPERIENCE_RANGES, EXPERIENCE_LOWER_MONTHS } from '@/i18n/he';
import { readProspect, writePendingSearch } from '@/features/prospect/state';
import type { Profession } from '@/types';

const DURATIONS = [
  { code: '1',  label: 'חודש' },
  { code: '3',  label: '3 חודשים' },
  { code: '6',  label: '6 חודשים' },
  { code: '12', label: 'שנה' },
  { code: '24', label: 'שנתיים+' },
] as const;

function addMonths(iso: string, months: number): string {
  if (!iso) return '';
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export default function TryProfessionFormPage() {
  const { profession } = useParams<{ profession: string }>();
  const router = useRouter();

  // Stale-tab guard — same pattern as the rest of /try/contractor/*.
  // If the prospect session has expired or the user deep-linked here
  // without going through /login, bounce them to /login with intent.
  useEffect(() => {
    if (typeof window !== 'undefined' && !readProspect()) {
      router.replace('/login?intent=contractor');
    }
  }, [router]);

  // Reference data — professions for the header label, plus regions +
  // origins for the form selects.
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

  // Form state — same shape as the production search form so the
  // PendingSearch stash can be replayed verbatim against /searches
  // after registration.
  const [quantity, setQuantity]         = useState<number>(1);
  const [originPref, setOriginPref]     = useState<string[]>([]);
  const [expRanges, setExpRanges]       = useState<string[]>([]);
  const [startDate, setStartDate]       = useState<string>('');
  const [durationCode, setDurationCode] = useState<string>('3');
  const [region, setRegion]             = useState<string>('');
  const [error, setError]               = useState<string>('');
  const [submitting, setSubmitting]     = useState(false);

  function toggleOrigin(code: string) {
    setOriginPref((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  }
  function toggleExp(code: string) {
    setExpRanges((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (quantity < 1) { setError('יש להזין כמות עובדים של לפחות 1'); return; }
    if (!startDate)   { setError('יש לבחור תאריך תחילת עבודה');     return; }

    const months = parseInt(durationCode, 10) || 3;
    const endDate = addMonths(startDate, months);
    const minExp = expRanges.length === 0
      ? 0
      : Math.min(...expRanges.map((r) => EXPERIENCE_LOWER_MONTHS[r] ?? 0));

    setSubmitting(true);
    // Stash the form data so the match-preview page (and later, the
    // post-registration auto-search step) can replay it. Same shape
    // as the /searches POST body, so the replay is a 1:1 send.
    writePendingSearch({
      recruitment_type: 'domestic',
      profession_type:  profession,
      quantity,
      start_date:       startDate,
      end_date:         endDate || undefined,
      region:           region || undefined,
      min_experience:   minExp,
      origin_preference: originPref,
      required_languages: [],
    });
    router.push('/try/contractor/match-preview');
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5" dir="rtl">
      <header className="space-y-1">
        <Link
          href="/try/contractor/domestic"
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
            <p className="text-xs text-slate-500">גיוס עובדים מהארץ</p>
          </div>
        </div>
      </header>

      <form
        onSubmit={handleSubmit}
        noValidate
        className="space-y-5 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm"
      >
        {/* AI hint banner */}
        <div className="flex items-start gap-2 bg-brand-50/60 border border-brand-100 rounded-lg px-3 py-2.5">
          <Sparkles className="w-4 h-4 text-brand-600 shrink-0 mt-0.5" />
          <p className="text-xs text-slate-700 leading-relaxed">
            ככל שתספק יותר פרטים, מנוע ההתאמה ימצא התאמה מדויקת יותר
          </p>
        </div>

        {/* 1. Quantity */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            כמות עובדים <span className="text-red-500">*</span>
          </label>
          {/* onFocus selects the current value so the user can just
              start typing — mirrors the behaviour of the shared
              <Input> component (QA-R3 #21). The trial form uses
              native inputs rather than the wrapped component for
              tighter layout control; we add the handler manually. */}
          <input
            type="number" min={1}
            value={quantity}
            onChange={(e) => setQuantity(parseInt(e.target.value || '1', 10))}
            onFocus={(e) => {
              const t = e.target as HTMLInputElement;
              requestAnimationFrame(() => { try { t.select(); } catch {} });
            }}
            className="w-32 border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </div>

        {/* 2. Origin preference */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">ארץ מוצא</label>
          <div className="flex flex-wrap gap-1.5">
            {origins.map((o) => {
              const active = originPref.includes(o.code);
              return (
                <button
                  type="button" key={o.code}
                  onClick={() => toggleOrigin(o.code)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
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

        {/* 3. Experience pills */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">ניסיון</label>
          <div className="flex flex-wrap gap-1.5">
            {EXPERIENCE_RANGES.map((r) => {
              const active = expRanges.includes(r.code);
              return (
                <button
                  type="button" key={r.code}
                  onClick={() => toggleExp(r.code)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
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

        {/* 4. Start date */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            תאריך תחילת עבודה <span className="text-red-500">*</span>
          </label>
          <input
            type="date" dir="ltr"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            onFocus={(e) => {
              const t = e.target as HTMLInputElement;
              requestAnimationFrame(() => { try { t.select(); } catch {} });
            }}
            className="w-44 border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </div>

        {/* 5. Duration */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">זמן תעסוקה</label>
          <div className="flex flex-wrap gap-1.5">
            {DURATIONS.map((d) => (
              <button
                type="button" key={d.code}
                onClick={() => setDurationCode(d.code)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
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

        {/* 6. Region (optional) */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">אזור עבודה</label>
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="w-full sm:w-72 border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          >
            <option value="">כל הארץ</option>
            {regions.map((r) => (
              <option key={r.code} value={r.code}>{r.name_he}</option>
            ))}
          </select>
        </div>

        {error && (
          <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-base shadow-sm transition-colors disabled:opacity-60"
        >
          {submitting ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> מחפש התאמות…</>
          ) : (
            <><SearchIcon className="h-4 w-4" /> חפש התאמות</>
          )}
        </button>
      </form>
    </div>
  );
}
