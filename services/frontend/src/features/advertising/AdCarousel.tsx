'use client';

// Pivot/v2 — top-banner ad slot with placeholder mode.
//
// Standard IAB Leaderboard placement (top of results). While we don't
// have paying advertisers yet, the slot shows "מקום פרסום זמין" so
// prospective advertisers can see the inventory exists. Rotates
// through a small set of placeholder slides on a 6s auto-advance
// with manual dots — the same pattern Yad2/Ynet/Facebook Marketplace
// use for their leaderboard ads.
//
// When real advertisers arrive (Phase 5.5+), replace the `slides`
// prop with a data-driven feed of paid campaigns.

import { useEffect, useState } from 'react';
import { Megaphone } from 'lucide-react';

export interface AdSlide {
  title: string;
  body:  string;
  cta:   string;
  href?: string;   // where the CTA links (mailto: for placeholder)
}

const PLACEHOLDER_SLIDES: AdSlide[] = [
  {
    title: 'מקום פרסום זמין',
    body:  'הגיעו לקהל של קבלנים ותאגידים בישראל דרך הבאנר הזה.',
    cta:   'לפרטים על פרסום',
    href:  'mailto:ads@buildupai.net?subject=%D7%A4%D7%A8%D7%A1%D7%95%D7%9D%20%D7%91%D7%91%D7%90%D7%A0%D7%A8',
  },
  {
    title: 'קמפיין ממוקד תוצאות חיפוש',
    body:  'פרסום מקצועי שמופיע בדיוק כשהקבלן מחפש. שילמו לפי חשיפות או לפי הקלקות.',
    cta:   'בקשו הצעת מחיר',
    href:  'mailto:ads@buildupai.net?subject=%D7%94%D7%A6%D7%A2%D7%AA%20%D7%9E%D7%97%D7%99%D7%A8',
  },
  {
    title: 'המקום שלך כאן',
    body:  'ספקי ציוד, שירותים לפועלים זרים, ביטוח והובלה — כל הענף רואה אתכם.',
    cta:   'צור קשר',
    href:  'mailto:ads@buildupai.net?subject=%D7%A4%D7%A8%D7%A1%D7%95%D7%9D%20%D7%91%D7%A4%D7%9C%D7%98%D7%A4%D7%95%D7%A8%D7%9E%D7%94',
  },
];

const AUTO_MS = 6000;

export function AdCarousel({
  slides = PLACEHOLDER_SLIDES,
  autoAdvanceMs = AUTO_MS,
}: {
  slides?: AdSlide[];
  autoAdvanceMs?: number;
}) {
  const [i, setI]     = useState(0);
  const [paused, setP] = useState(false);

  useEffect(() => {
    if (paused || slides.length <= 1) return;
    const t = setTimeout(() => setI((n) => (n + 1) % slides.length), autoAdvanceMs);
    return () => clearTimeout(t);
  }, [i, paused, slides.length, autoAdvanceMs]);

  const slide = slides[i];

  return (
    <div
      className="max-w-4xl mx-auto"
      onMouseEnter={() => setP(true)}
      onMouseLeave={() => setP(false)}
      aria-roledescription="carousel"
      aria-label="פרסומות"
    >
      {/* IAB standard "פרסומת" disclosure — always shown on top-left of slot */}
      <div className="flex items-center justify-between mb-1 text-[10px] uppercase tracking-wide text-slate-400">
        <span>פרסומת</span>
        <span>{i + 1} / {slides.length}</span>
      </div>

      <div className="relative rounded-2xl border border-dashed border-slate-300 bg-gradient-to-br from-slate-50 to-white p-5 sm:p-6 min-h-[110px] shadow-sm overflow-hidden">
        <div className="flex items-start gap-3 sm:gap-4">
          <div className="w-10 h-10 rounded-lg bg-brand-100 text-brand-700 flex items-center justify-center shrink-0">
            <Megaphone className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base sm:text-lg font-bold text-slate-900 truncate">{slide.title}</h3>
            <p className="text-xs sm:text-sm text-slate-600 mt-1 leading-relaxed">{slide.body}</p>
          </div>
          <a
            href={slide.href ?? '#'}
            className="hidden sm:inline-flex shrink-0 items-center bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold px-3.5 py-2 rounded-lg self-center"
          >
            {slide.cta}
          </a>
        </div>

        {/* Mobile CTA below the copy */}
        <a
          href={slide.href ?? '#'}
          className="sm:hidden mt-3 inline-flex items-center bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold px-3.5 py-2 rounded-lg"
        >
          {slide.cta}
        </a>
      </div>

      {/* Dots */}
      {slides.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 mt-2.5">
          {slides.map((_, n) => (
            <button
              key={n}
              type="button"
              onClick={() => setI(n)}
              aria-label={`עבור לפרסומת ${n + 1}`}
              className={`h-1.5 rounded-full transition-all ${n === i ? 'w-6 bg-brand-600' : 'w-1.5 bg-slate-300 hover:bg-slate-400'}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
