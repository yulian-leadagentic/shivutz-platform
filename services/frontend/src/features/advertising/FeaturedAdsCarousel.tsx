'use client';

// Pivot/v2 — landing "מקודמים" horizontal carousel (yad2-style commercial slot).
// Boosted ads first; if none, falls back to most-recent public feed.

import { useEffect, useRef, useState } from 'react';
import { ChevronRight, ChevronLeft, Zap, Building2, Home, Users } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';

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

export function FeaturedAdsCarousel() {
  const [ads, setAds] = useState<PublicAd[]>([]);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiFetch<{ results: PublicAd[] }>('/ads/public/featured?limit=12')
      .then((r) => {
        if (r.results.length > 0) setAds(r.results);
        // fall back to recent so the slot never renders empty
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
        <h2 className="text-lg sm:text-xl font-bold text-slate-900 flex items-center gap-2">
          <Zap className="w-5 h-5 text-amber-500" />
          מודעות מקודמות
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => scroll('right')}
            aria-label="הקודמים"
            className="w-8 h-8 rounded-full border border-slate-200 bg-white hover:bg-slate-50 inline-flex items-center justify-center"
          >
            <ChevronRight className="w-4 h-4 text-slate-600" />
          </button>
          <button
            type="button"
            onClick={() => scroll('left')}
            aria-label="הבאים"
            className="w-8 h-8 rounded-full border border-slate-200 bg-white hover:bg-slate-50 inline-flex items-center justify-center"
          >
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
          return (
            <a
              key={ad.id}
              href={`/?ad=${ad.id}`}
              className={`snap-start shrink-0 w-[260px] rounded-2xl border p-4 bg-white shadow-sm hover:shadow-md transition ${
                boosted ? 'border-amber-300' : 'border-slate-200'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                  isHousing ? 'bg-slate-100 text-slate-700' : 'bg-brand-50 text-brand-700'
                }`}>
                  {isHousing ? <Home className="w-4 h-4" /> : <Users className="w-4 h-4" />}
                </div>
                {boosted && (
                  <span className="ms-auto text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                    מקודם
                  </span>
                )}
              </div>
              <h3 className="text-sm font-bold text-slate-900 line-clamp-2 min-h-[2.5rem]">{ad.title_he}</h3>
              <p className="text-xs text-slate-500 mt-1 flex flex-wrap gap-x-2">
                {isHousing ? (
                  <>
                    {ad.city && <span>{ad.city}</span>}
                    {ad.available_beds && <span>· {ad.available_beds} מיטות</span>}
                    {ad.price_per_bed_nis && <span>· ₪{ad.price_per_bed_nis}</span>}
                  </>
                ) : (
                  <>
                    {ad.profession_code && <span>{ad.profession_code}</span>}
                    {ad.origin_country  && <span>· {ad.origin_country}</span>}
                    {ad.quantity        && <span>· {ad.quantity} עובדים</span>}
                  </>
                )}
              </p>
              <div className="mt-3 text-xs font-semibold text-brand-700 inline-flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5" />
                חשוף פרטי קשר ←
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}
