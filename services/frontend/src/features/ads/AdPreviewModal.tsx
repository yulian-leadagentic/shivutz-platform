'use client';

// Pivot/v2 — preview before publish.
// Shows the corp what their ad will look like on the contractor's
// search screen, then asks for confirmation before hitting the create
// endpoint. Prevents "wait, that's not what I meant to publish" the
// moment the ad hits the public feed.

import { useState } from 'react';
import {
  X, Loader2, Send, Home, Users, Building2,
  Layers, Bolt, Wrench, PaintBucket, Hammer, Boxes,
} from 'lucide-react';
import type { AdCreateInput } from '@/lib/api/ads';

const PROFESSION_STYLE: Record<string, { grad: string; icon: typeof Hammer; label: string }> = {
  flooring:    { grad: 'from-orange-500 to-rose-600',    icon: Layers,       label: 'ריצוף' },
  electrician: { grad: 'from-yellow-500 to-orange-600',  icon: Bolt,         label: 'חשמל' },
  electricity: { grad: 'from-yellow-500 to-orange-600',  icon: Bolt,         label: 'חשמל' },
  painting:    { grad: 'from-fuchsia-500 to-purple-600', icon: PaintBucket,  label: 'צביעה' },
  plumbing:    { grad: 'from-sky-500 to-blue-600',       icon: Wrench,       label: 'אינסטלציה' },
  plastering:  { grad: 'from-stone-500 to-neutral-700',  icon: Layers,       label: 'טיח' },
  formwork:    { grad: 'from-amber-500 to-orange-700',   icon: Hammer,       label: 'תפסן' },
  mason:       { grad: 'from-slate-500 to-slate-800',    icon: Hammer,       label: 'בנאי' },
  skeleton:    { grad: 'from-zinc-500 to-zinc-800',      icon: Bolt,         label: 'ברזלן' },
  scaffolding: { grad: 'from-teal-500 to-emerald-700',   icon: Boxes,        label: 'פיגומים' },
  general:     { grad: 'from-indigo-500 to-blue-700',    icon: Users,        label: 'פועל כללי' },
};
const HOUSING_STYLE = { grad: 'from-emerald-500 to-teal-700', icon: Home,     label: 'דיור' };
const DEFAULT_STYLE = { grad: 'from-slate-600 to-slate-800',   icon: Building2, label: 'מודעה' };

const ORIGIN_LABEL: Record<string, string> = {
  CN: 'סין', IN: 'הודו', LK: 'סרי לנקה', MD: 'מולדובה',
  PH: 'פיליפינים', RO: 'רומניה', TH: 'תאילנד', UA: 'אוקראינה', UZ: 'אוזבקיסטן',
};

function styleFor(p: AdCreateInput) {
  if (p.ad_type === 'housing') return HOUSING_STYLE;
  if (p.profession_code && PROFESSION_STYLE[p.profession_code]) return PROFESSION_STYLE[p.profession_code];
  return DEFAULT_STYLE;
}

export function AdPreviewModal({
  payload,
  onCancel,
  onConfirm,
}: {
  payload: AdCreateInput | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  if (!payload) return null;
  const isHousing = payload.ad_type === 'housing';
  const st        = styleFor(payload);
  const Icon      = st.icon;

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onConfirm();
    } catch (e) {
      setError((e as Error).message ?? 'שגיאה בפרסום');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
         onClick={() => !busy && onCancel()}
         role="dialog"
         aria-modal="true">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl p-6 space-y-4 relative"
           onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => !busy && onCancel()}
          aria-label="סגור"
          className="absolute top-3 end-3 w-8 h-8 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 inline-flex items-center justify-center"
        >
          <X className="w-4 h-4" />
        </button>

        <div>
          <h3 className="text-lg font-bold text-slate-900">תצוגה מקדימה</h3>
          <p className="text-sm text-slate-500 mt-1">כך המודעה תיראה לקבלנים המחפשים. בדוק ואשר לפרסום.</p>
        </div>

        {/* Preview card — mirrors the FeaturedAdsCarousel card style */}
        <div className="rounded-2xl overflow-hidden shadow-md">
          <div className={`relative bg-gradient-to-br ${st.grad} text-white p-4 h-32 overflow-hidden`}>
            <div className="absolute -bottom-4 -end-4 opacity-25 pointer-events-none">
              <Icon className="w-28 h-28" />
            </div>
            <div className="relative flex items-start">
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-white/25 backdrop-blur-sm rounded-full px-2 py-0.5">
                {st.label}
              </span>
            </div>
            <div className="relative mt-3">
              <p className="text-2xl font-extrabold leading-tight drop-shadow-sm">
                {isHousing
                  ? (payload.available_beds ? `${payload.available_beds} מיטות פנויות` : (payload.city || 'דיור'))
                  : (payload.quantity ? `${payload.quantity} ${st.label}` : st.label)}
              </p>
              <p className="text-xs text-white/85 mt-0.5">
                {isHousing
                  ? [payload.city, payload.price_per_bed_nis ? `₪${payload.price_per_bed_nis}/מיטה` : null].filter(Boolean).join(' · ')
                  : [payload.origin_country && `מוצא: ${ORIGIN_LABEL[payload.origin_country] ?? payload.origin_country}`, payload.region].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
          <div className="bg-white p-3">
            <p className="text-sm font-bold text-slate-900 line-clamp-1">{payload.title_he}</p>
            {payload.body_he && (
              <p className="text-xs text-slate-500 mt-1 line-clamp-3 leading-relaxed">{payload.body_he}</p>
            )}
            {isHousing && Array.isArray(payload.photos) && payload.photos.length > 0 && (
              <div className="mt-2 flex gap-1.5 overflow-x-auto">
                {payload.photos.slice(0, 4).map((url) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={url} src={url} alt="" className="w-16 h-16 rounded object-cover shrink-0 border border-slate-200" />
                ))}
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
        )}

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 border border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold py-2.5 rounded-lg disabled:opacity-50"
          >
            חזור לעריכה
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            className="flex-[2] bg-brand-600 hover:bg-brand-500 text-white font-semibold py-2.5 rounded-lg disabled:bg-slate-300 inline-flex items-center justify-center gap-2"
          >
            {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> מפרסם…</> : <><Send className="w-4 h-4" /> אשר ופרסם</>}
          </button>
        </div>
      </div>
    </div>
  );
}
