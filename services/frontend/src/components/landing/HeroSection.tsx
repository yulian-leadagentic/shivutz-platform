'use client';

import Link from 'next/link';
import { ChevronDown, ArrowLeft, Home, Wrench, Briefcase, Store, Users, Building2 } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

interface HeroSectionProps {
  onLeadCapture: () => void;
}

// Per key-user feedback (2026-05): the "active workers" tile is the one
// number that drives action. Other stats removed to reduce hero density.
// The tile itself is now a CTA — tap = login (or dashboard if logged in).
const HERO_STAT = { value: '1,200+', label: 'עובדים פעילים' };

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
  const { isLoggedIn, entityType } = useAuth();
  // Contractor CTA — logged-in visitors land on their role dashboard;
  // everyone else funnels to /login with intent=contractor so the login
  // page shows contractor-specific copy and skips the entity-select
  // screen after auth.
  const contractorCtaHref = !isLoggedIn
    ? '/login?intent=contractor'
    : entityType === 'corporation' ? '/corporation/dashboard'
    : entityType === 'contractor'  ? '/contractor/dashboard'
    : '/login?intent=contractor';
  // Corporation CTA — same shape, intent=corporation.
  const corporationCtaHref = !isLoggedIn
    ? '/login?intent=corporation'
    : entityType === 'corporation' ? '/corporation/dashboard'
    : entityType === 'contractor'  ? '/contractor/dashboard'
    : '/login?intent=corporation';

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
      <div className="relative">
        <div className="max-w-6xl mx-auto px-6 w-full pt-28 pb-12">
          {/* Top: brand + headline + subtitle, centered */}
          <div className="text-center space-y-6 mb-12">
            {/* Brand wordmark */}
            <div className="inline-flex items-center gap-2 text-amber-400 text-4xl md:text-5xl font-black tracking-tight" dir="ltr">
              BuildUp
            </div>

            <h1 className="text-3xl md:text-5xl font-extrabold leading-[1.15] tracking-tight text-white max-w-4xl mx-auto">
              הדרך החכמה לגייס
              <br className="hidden sm:block" />
              <span className="text-amber-400"> עובדים זרים</span>
            </h1>

            <p className="text-base md:text-lg text-slate-400 leading-relaxed max-w-2xl mx-auto">
              מערכת מבוססת AI להתאמת עובדים, שיבוץ וניהול תהליך הגיוס — במהירות, בפשטות ובזמן אמת.
            </p>

            <button
              onClick={onLeadCapture}
              className="text-sm text-slate-500 hover:text-slate-300 underline underline-offset-4 transition-colors"
            >
              השאר פרטים לחזרה
            </button>
          </div>

          {/* Two tiles SIDE-BY-SIDE — contractor (find workers) + corporation (publish workers) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 max-w-5xl mx-auto">
            {/* Contractor tile — anchored on the active-workers stat */}
            <Link
              href={contractorCtaHref}
              className="group flex flex-col items-center justify-center text-center bg-slate-800/50 hover:bg-slate-800 border border-slate-700/60 hover:border-amber-400/50 rounded-3xl p-7 md:p-9 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-2xl hover:shadow-amber-500/10"
            >
              {/* Audience label — biggest, brightest thing on the tile so
                  the user immediately knows which side this is. */}
              <div className="text-3xl md:text-4xl font-black text-amber-300 tracking-tight mb-4">
                קבלן
              </div>
              <div className="h-12 w-12 rounded-2xl bg-amber-500/20 flex items-center justify-center mb-4">
                <Users className="h-6 w-6 text-amber-300" />
              </div>
              <div className="text-4xl md:text-5xl font-extrabold text-white mb-1 group-hover:text-amber-300 transition-colors">
                {HERO_STAT.value}
              </div>
              <div className="text-sm text-slate-400 mb-4">{HERO_STAT.label}</div>
              <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-300 group-hover:text-amber-200">
                לחץ כאן לאיתור עובדים
                <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
              </div>
            </Link>

            {/* Corporation tile — invite manpower corporations to publish */}
            <Link
              href={corporationCtaHref}
              className="group flex flex-col items-center justify-center text-center bg-slate-800/50 hover:bg-slate-800 border border-slate-700/60 hover:border-sky-400/60 rounded-3xl p-7 md:p-9 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-2xl hover:shadow-sky-500/10"
            >
              {/* Audience label — same visual weight as the contractor
                  side so both sides read at a glance. */}
              <div className="text-3xl md:text-4xl font-black text-sky-300 tracking-tight mb-4">
                תאגיד
              </div>
              <div className="h-12 w-12 rounded-2xl bg-sky-500/20 flex items-center justify-center mb-4">
                <Building2 className="h-6 w-6 text-sky-300" />
              </div>
              <div className="text-base md:text-lg text-white font-semibold leading-snug mb-3 max-w-sm">
                עשרות קבלנים כבר מנויים לשירותים שלנו ומחפשים עובדים
              </div>
              {/* Pop-out subhead in the CTA color — per user feedback,
                  this needs to feel like an active call, not a footnote. */}
              <div className="text-lg md:text-xl text-sky-300 font-bold leading-snug mb-3">
                מנהל תאגיד — אל תישאר בחוץ
              </div>
              <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-sky-300 group-hover:text-sky-200">
                לחץ כאן ותתחיל לפרסם
                <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
              </div>
            </Link>
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
