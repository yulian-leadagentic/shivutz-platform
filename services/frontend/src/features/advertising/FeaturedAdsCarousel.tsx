'use client';

// Pivot/v2 — "מודעות מקודמות" carousel (yad2-style commercial slot).
// Each card is a bold gradient hero tinted by profession or ad type,
// so the strip reads as real creative even without corp-uploaded photos.
// Boosted ads render first; falls back to recent so the slot is never
// empty.

import { useEffect, useRef, useState } from 'react';
import {
  ChevronRight, ChevronLeft, Flame, Home, Users,
  Building2, Hammer, Wrench, PaintBucket, Bolt, Plug, Layers, Boxes,
} from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import { PromotedBadge } from '@/components/ads/PromotedBadge';

interface PublicAd {
  id:              string;
  ad_type:         'worker' | 'housing';
  title_he:        string;
  body_he:         string | null;
  region:          string | null;
  profession_code: string | null;
  origin_country:  string | null;
  quantity:        number | null;
  city:            string | null;
  available_beds:  number | null;
  price_per_bed_nis: number | null;
  photos:          string[] | null;
  featured_until:  string | null;
  published_at:    string;
}

// Profession → gradient + icon. Falls back to a neutral navy for
// unknown codes (or housing, handled separately).
const PROFESSION_STYLE: Record<string, { grad: string; icon: typeof Hammer }> = {
  flooring:     { grad: 'from-orange-500 to-rose-600',      icon: Layers },
  electrician:  { grad: 'from-yellow-500 to-orange-600',    icon: Bolt },
  electricity:  { grad: 'from-yellow-500 to-orange-600',    icon: Bolt },
  painting:     { grad: 'from-fuchsia-500 to-purple-600',   icon: PaintBucket },
  plumbing:     { grad: 'from-sky-500 to-blue-600',         icon: Wrench },
  plastering:   { grad: 'from-stone-500 to-neutral-700',    icon: Layers },
  formwork:     { grad: 'from-amber-500 to-orange-700',     icon: Hammer },
  mason:        { grad: 'from-slate-500 to-slate-800',      icon: Hammer },
  skeleton:     { grad: 'from-zinc-500 to-zinc-800',        icon: Bolt },
  scaffolding:  { grad: 'from-teal-500 to-emerald-700',     icon: Boxes },
  general:      { grad: 'from-indigo-500 to-blue-700',      icon: Users },
};
const HOUSING_STYLE = { grad: 'from-emerald-500 to-teal-700', icon: Home };
const DEFAULT_STYLE = { grad: 'from-slate-600 to-slate-800',   icon: Building2 };

const PROFESSION_LABEL: Record<string, string> = {
  flooring: 'ריצוף', electrician: 'חשמל', electricity: 'חשמל',
  painting: 'צביעה', plumbing: 'אינסטלציה', plastering: 'טיח',
  formwork: 'תפסן', mason: 'בנאי', skeleton: 'ברזלן',
  scaffolding: 'פיגומים', general: 'פועל כללי',
};
const ORIGIN_LABEL: Record<string, string> = {
  CN: 'סין', IN: 'הודו', LK: 'סרי לנקה', MD: 'מולדובה',
  PH: 'פיליפינים', RO: 'רומניה', TH: 'תאילנד', UA: 'אוקראינה', UZ: 'אוזבקיסטן',
};

function styleFor(ad: PublicAd) {
  if (ad.ad_type === 'housing') return HOUSING_STYLE;
  if (ad.profession_code && PROFESSION_STYLE[ad.profession_code]) return PROFESSION_STYLE[ad.profession_code];
  return DEFAULT_STYLE;
}

export function FeaturedAdsCarousel() {
  const [ads, setAds] = useState<PublicAd[]>([]);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiFetch<{ results: PublicAd[] }>('/ads/public/featured?limit=12')
      .then((r) => {
        if (r.results.length > 0) setAds(r.results);
        else apiFetch<{ results: PublicAd[] }>('/ads/public/recent?limit=12').then((rr) => setAds(rr.results));
      })
      .catch(() => setAds([]));
  }, []);

  if (ads.length === 0) return null;

  function scroll(dir: 'left' | 'right') {
    if (!scroller.current) return;
    const w = scroller.current.clientWidth * 0.85;
    scroller.current.scrollBy({ left: dir === 'right' ? w : -w, behavior: 'smooth' });
  }

  return (
    <section className="max-w-6xl mx-auto px-4">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 flex items-center gap-2">
            <Flame className="w-5 h-5 text-brand-700 fill-brand-500" />
            חם בפורטל
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">מודעות מקודמות של תאגידים</p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => scroll('right')} aria-label="הקודמים"
            className="w-8 h-8 rounded-full border border-slate-200 bg-white hover:bg-slate-50 inline-flex items-center justify-center">
            <ChevronRight className="w-4 h-4 text-slate-600" />
          </button>
          <button type="button" onClick={() => scroll('left')} aria-label="הבאים"
            className="w-8 h-8 rounded-full border border-slate-200 bg-white hover:bg-slate-50 inline-flex items-center justify-center">
            <ChevronLeft className="w-4 h-4 text-slate-600" />
          </button>
        </div>
      </div>

      <div
        ref={scroller}
        className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scroll-smooth"
        style={{ scrollbarWidth: 'thin' }}
      >
        {ads.map((ad) => {
          const boosted = ad.featured_until && new Date(ad.featured_until) > new Date();
          const isHousing = ad.ad_type === 'housing';
          const st = styleFor(ad);
          const Icon = st.icon;
          const profLabel = ad.profession_code ? (PROFESSION_LABEL[ad.profession_code] ?? ad.profession_code) : '';
          const orgLabel  = ad.origin_country  ? (ORIGIN_LABEL[ad.origin_country]  ?? ad.origin_country)  : '';
          return (
            <a
              key={ad.id}
              href={`/?ad=${ad.id}`}
              className="snap-start shrink-0 w-[260px] sm:w-[280px] rounded-2xl overflow-hidden shadow-md hover:shadow-lg transition group flex flex-col"
            >
              {/* Gradient hero.
                  M1 — was `h-32 overflow-hidden`, which clipped Hebrew
                  titles like "5 מיטות פנויות באזור המרכז" whose
                  ascenders + subline pushed past 128px on mobile. Now
                  `min-h-32` lets the box grow with content, and the
                  decorative icon is smaller + more transparent so it
                  reads as a watermark instead of crowding the copy. */}
              <div className={`relative bg-gradient-to-br ${st.grad} text-white p-4 min-h-32 overflow-hidden`}>
                <div className="absolute -bottom-4 -end-4 opacity-15 sm:opacity-25 pointer-events-none" aria-hidden="true">
                  <Icon className="w-20 h-20 sm:w-28 sm:h-28" />
                </div>
                <div className="relative flex items-start justify-between gap-2">
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-white/25 backdrop-blur-sm rounded-full px-2 py-0.5">
                    {isHousing ? 'דיור' : (profLabel || 'עובדים')}
                  </span>
                  {boosted && <PromotedBadge size="sm" />}
                </div>
                <div className="relative mt-3">
                  <p className="text-xl sm:text-2xl font-extrabold leading-tight drop-shadow-sm break-words">
                    {isHousing
                      ? (ad.available_beds ? `${ad.available_beds} מיטות פנויות` : (ad.city || 'דיור'))
                      : (ad.quantity ? `${ad.quantity} ${profLabel || 'עובדים'}` : (profLabel || 'עובדים'))}
                  </p>
                  <p className="text-xs text-white/85 mt-0.5 break-words">
                    {isHousing
                      ? [ad.city, ad.price_per_bed_nis ? `₪${ad.price_per_bed_nis}/מיטה` : null].filter(Boolean).join(' · ')
                      : [orgLabel && `מוצא: ${orgLabel}`, ad.region].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </div>

              {/* Body strip */}
              <div className="bg-white p-3 flex-1 flex flex-col">
                <p className="text-sm font-bold text-slate-900 line-clamp-1">{ad.title_he}</p>
                {ad.body_he && (
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">{ad.body_he}</p>
                )}
                <div className="mt-2 text-xs font-semibold text-brand-700 inline-flex items-center gap-1 group-hover:gap-2 transition-all">
                  <Building2 className="w-3.5 h-3.5" />
                  לחץ לחשיפת פרטי התאגיד ←
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}
