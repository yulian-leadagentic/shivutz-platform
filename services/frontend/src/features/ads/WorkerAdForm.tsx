'use client';

// Pivot/v2 Phase 2 — corp's worker-ad publish/edit form.
// Used by /corporation/ads/new and /corporation/ads/[id]/edit. Housing
// ads ship in Phase 4 via a separate HousingAdForm component.

import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { enumApi } from '@/lib/api/enums';
import type { AdCreateInput } from '@/lib/api/ads';
import type { Profession } from '@/types';

export interface WorkerAdFormValues {
  title_he: string;
  body_he: string;
  profession_code: string;
  origin_country: string;
  region: string;
  quantity: number;
  experience_min_months: number;
  visa_valid_until: string;
  languages: string[];
}

const EMPTY: WorkerAdFormValues = {
  title_he: '',
  body_he: '',
  profession_code: '',
  origin_country: '',
  region: '',
  quantity: 1,
  experience_min_months: 0,
  visa_valid_until: '',
  languages: [],
};

export function WorkerAdForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: Partial<WorkerAdFormValues>;
  submitLabel: string;
  onSubmit: (payload: AdCreateInput) => Promise<void>;
}) {
  const [v, setV]               = useState<WorkerAdFormValues>({ ...EMPTY, ...initial });
  const [profs, setProfs]       = useState<Profession[]>([]);
  const [regions, setRegions]   = useState<{ code: string; name_he: string }[]>([]);
  const [origins, setOrigins]   = useState<{ code: string; name_he: string }[]>([]);
  const [submitting, setSub]    = useState(false);
  const [error, setError]       = useState('');

  useEffect(() => {
    Promise.allSettled([
      enumApi.professions().then(setProfs),
      enumApi.regions().then(setRegions),
      enumApi.origins().then(setOrigins),
    ]);
  }, []);

  function field<K extends keyof WorkerAdFormValues>(key: K) {
    return (value: WorkerAdFormValues[K]) => setV((s) => ({ ...s, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError('');
    if (!v.title_he.trim()) { setError('יש להזין כותרת'); return; }
    if (!v.profession_code) { setError('יש לבחור מקצוע'); return; }
    if (v.quantity < 1)     { setError('כמות חייבת להיות 1 או יותר'); return; }
    setSub(true);
    try {
      await onSubmit({
        ad_type:               'worker',
        title_he:              v.title_he.trim(),
        body_he:               v.body_he.trim() || undefined,
        profession_code:       v.profession_code,
        origin_country:        v.origin_country || undefined,
        region:                v.region || undefined,
        quantity:              v.quantity,
        experience_min_months: v.experience_min_months || undefined,
        visa_valid_until:      v.visa_valid_until || undefined,
        languages:             v.languages.length ? v.languages : undefined,
      });
    } catch (e) {
      setError((e as Error).message ?? 'שגיאה בשמירת המודעה');
      setSub(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
          כותרת המודעה <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={v.title_he}
          onChange={(e) => field('title_he')(e.target.value)}
          placeholder="לדוגמה: 4 רצפים מסין זמינים מיידית"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
          מקצוע <span className="text-red-500">*</span>
        </label>
        <select
          value={v.profession_code}
          onChange={(e) => field('profession_code')(e.target.value)}
          className="w-full sm:w-72 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none"
        >
          <option value="">בחר…</option>
          {profs.map((p) => <option key={p.code} value={p.code}>{p.name_he}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">ארץ מוצא</label>
          <select
            value={v.origin_country}
            onChange={(e) => field('origin_country')(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none"
          >
            <option value="">לא צויין</option>
            {origins.map((o) => <option key={o.code} value={o.code}>{o.name_he}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">אזור</label>
          <select
            value={v.region}
            onChange={(e) => field('region')(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none"
          >
            <option value="">לא צויין</option>
            {regions.map((r) => <option key={r.code} value={r.code}>{r.name_he}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            כמות עובדים <span className="text-red-500">*</span>
          </label>
          <input
            type="number" min={1}
            value={v.quantity}
            onChange={(e) => field('quantity')(parseInt(e.target.value || '1', 10))}
            className="w-32 border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">ניסיון מינ' (חודשים)</label>
          <input
            type="number" min={0}
            value={v.experience_min_months}
            onChange={(e) => field('experience_min_months')(parseInt(e.target.value || '0', 10))}
            className="w-32 border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">ויזה בתוקף עד</label>
          <input
            type="date"
            value={v.visa_valid_until}
            onChange={(e) => field('visa_valid_until')(e.target.value)}
            className="w-44 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1.5">תיאור חופשי (משפר חיפוש)</label>
        <textarea
          value={v.body_he}
          onChange={(e) => field('body_he')(e.target.value)}
          rows={4}
          placeholder="פרטים נוספים שיעזרו לקבלן להבין מה אתם מציעים — ניסיון בעבודה ספציפית, יכולות שפה, אמינות וכו'"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full bg-brand-600 hover:bg-brand-500 text-white font-semibold py-3 rounded-lg
                   disabled:bg-slate-400 inline-flex items-center justify-center gap-2 transition"
      >
        {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> שומר...</> : <><Save className="w-4 h-4" /> {submitLabel}</>}
      </button>
    </form>
  );
}
