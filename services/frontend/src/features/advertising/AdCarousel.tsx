'use client';

// Pivot/v2 — top-banner ad slot.
// Colorful gradient slides that read as real ad creative (not empty
// placeholder). CTA opens the in-app inquiry modal instead of mailto:
// so leads land in /admin/support instead of a mailbox that probably
// doesn't exist yet.

import { useEffect, useState } from 'react';
import { Megaphone, Zap, Star, Handshake, ArrowLeft } from 'lucide-react';
import { AdInquiryModal } from './AdInquiryModal';

export interface AdSlide {
  eyebrow: string;
  title:   string;
  body:    string;
  cta:     string;
  icon:    typeof Megaphone;
  /** Tailwind gradient classes for the slide background. */
  gradient: string;
  /** Solid accent for the CTA button. */
  accent:   string;
}

const PLACEHOLDER_SLIDES: AdSlide[] = [
  {
    eyebrow: 'הפוטנציאל שלכם',
    title:   'מאות קבלנים מחפשים תאגידים אמינים לאספקת עובדים',
    body:    'הופיעו בראש התוצאות כשקבלן מקליד את מה שהוא צריך. תשלמו רק אם התוצאה מוצגת.',
    cta:     'לפרסום מודעה',
    icon:    Zap,
    gradient: 'from-amber-400 via-orange-500 to-rose-500',
    accent:  'bg-white text-orange-700 hover:bg-orange-50',
  },
  {
    eyebrow: 'המקום שלכם כאן',
    title:   'ספקי ציוד ושירותים לפועלים זרים — כל הענף רואה אתכם',
    body:    'ביטוח · הובלה · אוכל · שירותים משפטיים · חיבור ישיר לתאגידים וקבלנים פעילים.',
    cta:     'קבלו הצעת מחיר',
    icon:    Handshake,
    gradient: 'from-sky-500 via-indigo-500 to-purple-600',
    accent:  'bg-white text-indigo-700 hover:bg-indigo-50',
  },
  {
    eyebrow: 'קמפיין ממוקד',
    title:   'הופיעו רק לקבלנים שמחפשים בדיוק את המקצוע שלכם',
    body:    'טירגוט לפי מקצוע · ארץ מוצא · אזור. תשלום לפי חשיפה או הקלקה.',
    cta:     'צור קשר',
    icon:    Star,
    gradient: 'from-emerald-500 via-teal-500 to-cyan-600',
    accent:  'bg-white text-emerald-700 hover:bg-emerald-50',
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
  const [i, setI]           = useState(0);
  const [paused, setP]      = useState(false);
  const [inquiryOpen, setQ] = useState(false);

  // Round-2 FIX-3 — counter showed "3 / 2" when the slides array
  // shrank while `i` was already past the new max. Clamp on every
  // slides-length change so display stays in-range.
  useEffect(() => {
    if (i >= slides.length) setI(Math.max(0, slides.length - 1));
  }, [slides.length, i]);

  useEffect(() => {
    if (paused || inquiryOpen || slides.length <= 1) return;
    const t = setTimeout(() => setI((n) => (n + 1) % slides.length), autoAdvanceMs);
    return () => clearTimeout(t);
  }, [i, paused, inquiryOpen, slides.length, autoAdvanceMs]);

  const safeI = Math.min(i, slides.length - 1);
  const slide = slides[safeI];
  const Icon  = slide.icon;

  return (
    <>
      <div
        className="max-w-5xl mx-auto"
        onMouseEnter={() => setP(true)}
        onMouseLeave={() => setP(false)}
        aria-roledescription="carousel"
        aria-label="פרסומות"
      >
        <div className="flex items-center justify-between mb-1.5 text-[10px] uppercase tracking-wide text-slate-400">
          <span>פרסומת</span>
          {/* CU-2 — was rendering "3 / 1" instead of "1 / 3" because
              the numeric string was inheriting the parent's RTL
              direction. dir="ltr" isolates the counter into its own
              bidi run, matching the DS "numbers/codes = LTR" rule. */}
          <span dir="ltr">{safeI + 1} / {slides.length}</span>
        </div>

        <div className={`relative rounded-2xl overflow-hidden shadow-lg bg-gradient-to-l ${slide.gradient} text-white`}>
          {/* Decorative background glyph — hidden on mobile because at
              390 the copy sits over it and reads as if the icon is
              floating behind the text. Kept on sm+ where the card is
              wide enough for the glyph to sit in the corner as
              intended. */}
          <div className="hidden sm:block absolute -bottom-8 -end-8 opacity-20 pointer-events-none" aria-hidden="true">
            <Icon className="w-56 h-56" />
          </div>

          {/* Round-2 FIX-2 — was `flex items-center gap-4 flex-wrap
              sm:flex-nowrap`, which at 390 tried to fit icon + text +
              button in one row, wrapped the text word-per-line, and
              let the button overlap the copy. Now mobile is a strict
              vertical stack (icon+eyebrow on top, title, body,
              full-width CTA at the bottom); sm+ keeps the desktop
              horizontal row. */}
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            <div className="flex items-center gap-3 sm:contents">
              <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
                <Icon className="w-6 h-6 sm:w-7 sm:h-7" />
              </div>
              <p className="sm:hidden text-[11px] font-semibold uppercase tracking-wider opacity-80">{slide.eyebrow}</p>
            </div>
            <div className="min-w-0 sm:flex-1">
              <p className="hidden sm:block text-[11px] font-semibold uppercase tracking-wider opacity-80">{slide.eyebrow}</p>
              <h3 className="text-lg sm:text-xl font-extrabold leading-tight sm:mt-0.5 drop-shadow-sm break-words">{slide.title}</h3>
              <p className="text-sm text-white/90 mt-1 leading-relaxed break-words">{slide.body}</p>
            </div>
            <button
              type="button"
              onClick={() => setQ(true)}
              className={`w-full sm:w-auto sm:shrink-0 min-h-11 inline-flex items-center justify-center gap-2 ${slide.accent} font-semibold px-5 py-2.5 rounded-xl shadow-md text-sm`}
            >
              {slide.cta}
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
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
                className={`h-1.5 rounded-full transition-all ${n === safeI ? 'w-6 bg-slate-700' : 'w-1.5 bg-slate-300 hover:bg-slate-400'}`}
              />
            ))}
          </div>
        )}
      </div>

      <AdInquiryModal
        open={inquiryOpen}
        onClose={() => setQ(false)}
        subject="ad-inquiry"
        heading="פרסמו בפורטל"
        tagline="השאירו פרטים ונחזור אליכם עם הצעת מחיר מותאמת."
      />
    </>
  );
}
