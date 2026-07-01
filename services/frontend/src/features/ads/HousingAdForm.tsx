'use client';

// Pivot/v2 Phase 4 — corp's housing-ad publish/edit form.
// Sits alongside WorkerAdForm; both post to the same /ads endpoint
// with different ad_type.
//
// Photos: v1 accepts a comma-separated URL list. Real drag-and-drop
// upload is a Phase 4.5 candidate — Cloudinary was mentioned by the
// user; wiring it goes on the marketplace_uploads route.

import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { enumApi } from '@/lib/api/enums';
import type { AdCreateInput } from '@/lib/api/ads';

const AMENITIES = [
  { code: 'AC',        label: 'מזגן' },
  { code: 'WIFI',      label: 'אינטרנט' },
  { code: 'KITCHEN',   label: 'מטבח' },
  { code: 'LAUNDRY',   label: 'כביסה' },
  { code: 'SHOWER',    label: 'מקלחת' },
  { code: 'PARKING',   label: 'חניה' },
  { code: 'FURNISHED', label: 'ריהוט' },
];

export interface HousingAdFormValues {
  title_he: string;
  body_he: string;
  city: string;
  address_he: string;
  region: string;
  total_beds: number;
  available_beds: number;
  price_per_bed_nis: number;
  amenities: string[];
  photos: string;  // comma-separated URLs
}

const EMPTY: HousingAdFormValues = {
  title_he: '',
  body_he: '',
  city: '',
  address_he: '',
  region: '',
  total_beds: 4,
  available_beds: 4,
  price_per_bed_nis: 0,
  amenities: [],
  photos: '',
};

export function HousingAdForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: Partial<HousingAdFormValues>;
  submitLabel: string;
  onSubmit: (payload: AdCreateInput) => Promise<void>;
}) {
  const [v, setV]             = useState<HousingAdFormValues>({ ...EMPTY, ...initial });
  const [regions, setRegions] = useState<{ code: string; name_he: string }[]>([]);
  const [submitting, setSub]  = useState(false);
  const [error, setError]     = useState('');

  useEffect(() => {
    enumApi.regions().then(setRegions).catch(() => {});
  }, []);

  function field<K extends keyof HousingAdFormValues>(key: K) {
    return (value: HousingAdFormValues[K]) => setV((s) => ({ ...s, [key]: value }));
  }

  function toggleAmenity(code: string) {
    setV((s) => ({
      ...s,
      amenities: s.amenities.includes(code)
        ? s.amenities.filter((c) => c !== code)
        : [...s.amenities, code],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError('');
    if (!v.title_he.trim()) { setError('יש להזין כותרת'); return; }
    if (!v.city.trim())     { setError('יש להזין עיר'); return; }
    if (v.total_beds < 1)   { setError('מספר מיטות חייב להיות 1 או יותר'); return; }
    if (v.available_beds > v.total_beds) { setError('מיטות פנויות לא יכול לעלות על סך המיטות'); return; }
    setSub(true);

    const photoList = v.photos.split(',').map((s) => s.trim()).filter(Boolean);

    try {
      await onSubmit({
        ad_type:  'housing',
        title_he: v.title_he.trim(),
        body_he:  v.body_he.trim() || undefined,
        region:   v.region || undefined,
        // Housing-specific fields — reuse the shared AdCreateInput
        // (backend accepts them; TS type allows the extra keys via cast).
        ...({
          city:              v.city.trim(),
          address_he:        v.address_he.trim() || undefined,
          total_beds:        v.total_beds,
          available_beds:    v.available_beds,
          price_per_bed_nis: v.price_per_bed_nis || undefined,
          amenities:         v.amenities.length ? v.amenities : undefined,
          photos:            photoList.length ? photoList : undefined,
        } as Partial<AdCreateInput>),
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
          placeholder="לדוגמה: דירה 4 חדרים לפועלים במרכז תל אביב"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            עיר <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={v.city}
            onChange={(e) => field('city')(e.target.value)}
            placeholder="תל אביב"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
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

      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1.5">כתובת</label>
        <input
          type="text"
          value={v.address_he}
          onChange={(e) => field('address_he')(e.target.value)}
          placeholder="רחוב, מספר בית"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            סך מיטות <span className="text-red-500">*</span>
          </label>
          <input
            type="number" min={1}
            value={v.total_beds}
            onChange={(e) => field('total_beds')(parseInt(e.target.value || '1', 10))}
            className="w-32 border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">מיטות פנויות</label>
          <input
            type="number" min={0}
            value={v.available_beds}
            onChange={(e) => field('available_beds')(parseInt(e.target.value || '0', 10))}
            className="w-32 border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">מחיר למיטה (₪/חודש)</label>
          <input
            type="number" min={0}
            value={v.price_per_bed_nis}
            onChange={(e) => field('price_per_bed_nis')(parseInt(e.target.value || '0', 10))}
            className="w-32 border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1.5">שירותים כלולים</label>
        <div className="flex flex-wrap gap-1.5">
          {AMENITIES.map((a) => {
            const active = v.amenities.includes(a.code);
            return (
              <button
                type="button"
                key={a.code}
                onClick={() => toggleAmenity(a.code)}
                className={`text-xs px-3 py-1.5 rounded-full border transition ${
                  active
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-slate-700 border-slate-300 hover:border-brand-400'
                }`}
              >
                {a.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
          תמונות (URLים מופרדים בפסיק)
        </label>
        <textarea
          value={v.photos}
          onChange={(e) => field('photos')(e.target.value)}
          rows={2}
          placeholder="https://... , https://..."
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
        <p className="text-xs text-slate-400 mt-1">העלאה מהמחשב תגיע ב-Phase 4.5</p>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1.5">תיאור חופשי (משפר חיפוש)</label>
        <textarea
          value={v.body_he}
          onChange={(e) => field('body_he')(e.target.value)}
          rows={4}
          placeholder="פרטים נוספים — מרחק מתחבורה ציבורית, מיקום ביחס לפרויקטים, כללי הבית וכו'"
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
