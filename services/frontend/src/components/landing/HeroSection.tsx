'use client';

import Link from 'next/link';
import { CheckCircle2, ChevronDown, ArrowLeft, Home, Wrench, Briefcase, Store } from 'lucide-react';

interface HeroSectionProps {
  onLeadCapture: () => void;
}

const STATS = [
  { value: '150+', label: 'תאגידים מאושרים' },
  { value: '500+', label: 'קבלנים רשומים' },
  { value: '1,200+', label: 'עובדים פעילים' },
  { value: '48 ש׳', label: 'זמן אישור ממוצע' },
];

const MARKET_CATS = [
  {
    icon: Home,
    label: 'דיור לעובדים',
    desc: 'דירות ומעונות לשיכון עובדים זרים',
    href: '/marketplace?category=housing',
    accent: 'bg-brand-500',
    iconBg: 'bg-brand-500/20',
    iconColor: 'text-brand-300',
    labelColor: 'text-white',
    descColor: 'text-slate-400',
  },
  {
    icon: Wrench,
    label: 'ציוד ומכונות',
    desc: 'השכרת ציוד בנייה וכלי עבודה',
    href: '/marketplace?category=equipment',
    accent: 'bg-amber-500',
    iconBg: 'bg-amber-500/20',
    iconColor: 'text-amber-300',
    labelColor: 'text-white',
    descColor: 'text-slate-400',
  },
  {
    icon: Briefcase,
    label: 'שירותים',
    desc: 'לוגיסטיקה, הסעות ושירותי תמיכה',
    href: '/marketplace?category=services',
    accent: 'bg-emerald-500',
    iconBg: 'bg-emerald-500/20',
    iconColor: 'text-emerald-300',
    labelColor: 'text-white',
    descColor: 'text-slate-400',
  },
  {
    icon: Store,
    label: 'כל המודעות',
    desc: 'עיון חופשי בכל הפרסומים',
    href: '/marketplace',
    accent: 'bg-slate-500',
    iconBg: 'bg-slate-600',
    iconColor: 'text-slate-300',
    labelColor: 'text-white',
    descColor: 'text-slate-400',
  },
];

export default function HeroSection({ onLeadCapture }: HeroSectionProps) {
  return (
    <section
      className="relative flex flex-col overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #0a0f1e 0%, #0f172a 60%, #111827 100%)' }}
    >
      {/* Subtle top-right glow */}
      <div
        className="pointer-events-none absolute top-0 end-0 h-[480px] w-[480px] rounded-full opacity-20"
        style={{ background: 'radial-gradient(circle, #4f46e5 0%, transparent 70%)', transform: 'translate(30%, -30%)' }}
      />
      {/* Dot texture */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '32px 32px' }}
      />

      {/* ── Main hero content ── */}
      <div className="relative flex items-center">
        <div className="max-w-7xl mx-auto px-6 w-full pt-28 pb-10">
          <div className="grid lg:grid-cols-2 gap-16 items-center">

            {/* Text */}
            <div className="space-y-8">
              {/* Pill */}
              <div className="inline-flex items-center gap-2 border border-slate-700 text-slate-400 text-xs font-medium px-4 py-1.5 rounded-full bg-slate-800/60">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                הפלטפורמה המובילה לעובדים זרים בבנייה
              </div>

              {/* Headline */}
              <h1 className="text-5xl md:text-6xl font-extrabold leading-[1.08] tracking-tight text-white">
                השוק הדיגיטלי
                <br />
                לכוח אדם זר
                <br />
                <span className="text-amber-400">בענף הבנייה</span>
              </h1>

              {/* Subtitle */}
              <p className="text-lg text-slate-400 leading-relaxed max-w-lg">
                מחבר קבלנים עם תאגידי כוח אדם מורשים — בחירת עובדים, שיבוץ, עסקאות ותשלום — הכל במקום אחד.
              </p>

              {/* Trust chips */}
              <div className="flex flex-wrap gap-2">
                {['תאגידים מורשים בלבד', 'תשלום מאובטח', 'ממשק עברי', 'אישור 48 שעות'].map((t) => (
                  <span key={t} className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-3 py-1.5 rounded-full">
                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                    {t}
                  </span>
                ))}
              </div>

              {/* CTAs */}
              <div className="flex flex-wrap gap-3 pt-1">
                <Link
                  href="/register/contractor"
                  className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white font-semibold text-sm px-6 py-3 rounded-xl shadow-lg shadow-brand-600/30 transition-all hover:-translate-y-0.5"
                >
                  אני קבלן — הצטרף בחינם
                  <ArrowLeft className="h-4 w-4" />
                </Link>
                <Link
                  href="/register/corporation"
                  className="inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white font-semibold text-sm px-6 py-3 rounded-xl border border-slate-700 transition-all hover:-translate-y-0.5"
                >
                  אני תאגיד — פרסם עובדים
                </Link>
                <button
                  onClick={onLeadCapture}
                  className="text-sm text-slate-500 hover:text-slate-300 underline underline-offset-4 transition-colors self-center px-2"
                >
                  השאר פרטים לחזרה
                </button>
              </div>
            </div>

            {/* Stats */}
            <div className="hidden lg:grid grid-cols-2 gap-4">
              {STATS.map((s) => (
                <div key={s.label} className="bg-slate-800/50 border border-slate-700/60 rounded-2xl p-6 hover:bg-slate-800 hover:border-slate-600 transition-all duration-200">
                  <div className="text-4xl font-extrabold text-white mb-1">{s.value}</div>
                  <div className="text-sm text-slate-400">{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Mobile stats */}
          <div className="lg:hidden mt-10 grid grid-cols-2 gap-3">
            {STATS.map((s) => (
              <div key={s.label} className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 text-center">
                <div className="text-2xl font-extrabold text-white">{s.value}</div>
                <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Marketplace quick-access bar ── */}
      <div className="relative border-t border-slate-800/80">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">
            שוק תאגידים — גלוש ישירות לפי קטגוריה
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {MARKET_CATS.map(({ icon: Icon, label, desc, href, accent, iconBg, iconColor, labelColor, descColor }) => (
              <Link
                key={href}
                href={href}
                className="group flex flex-col bg-slate-800 hover:bg-slate-750 border border-slate-700 hover:border-slate-600 rounded-2xl overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/30"
              >
                {/* Color accent stripe */}
                <div className={`h-1 w-full ${accent}`} />
                <div className="flex items-center gap-3 p-4">
                  <div className={`h-9 w-9 rounded-xl ${iconBg} flex items-center justify-center shrink-0`}>
                    <Icon className={`h-4.5 w-4.5 ${iconColor}`} />
                  </div>
                  <div>
                    <p className={`text-sm font-semibold ${labelColor}`}>{label}</p>
                    <p className={`text-xs ${descColor} mt-0.5 leading-snug`}>{desc}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Scroll cue */}
      <div className="relative flex justify-center py-5">
        <a href="#trust-bar" className="flex flex-col items-center gap-1 text-slate-600 hover:text-slate-400 transition-colors">
          <span className="text-xs">גלול למטה</span>
          <ChevronDown className="h-4 w-4 animate-bounce" />
        </a>
      </div>
    </section>
  );
}
