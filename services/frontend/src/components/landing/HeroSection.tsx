'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Home, Wrench, Briefcase, Store, Users, Building2, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { otpApi } from '@/lib/api';
import { saveTokens } from '@/lib/auth';

// Lead-capture button removed from the hero per user feedback —
// the two role-specific tiles are clearer entry points and the
// callback CTA was diluting that. Prop kept for now since the
// landing page wrapper still passes it (LeadCaptureModal lives
// outside the hero); marking it optional + ignoring it here is
// the lowest-friction option.
interface HeroSectionProps {
  onLeadCapture?: () => void;
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
    iconBg: 'bg-brand-100',
    iconColor: 'text-brand-600',
    labelColor: 'text-slate-900',
    descColor: 'text-slate-500',
  },
  {
    icon: Wrench,
    label: 'ציוד ומכונות',
    desc: 'השכרת ציוד בנייה וכלי עבודה',
    href: '/marketplace?category=equipment',
    accent: 'bg-brand-500',
    iconBg: 'bg-brand-100',
    iconColor: 'text-brand-600',
    labelColor: 'text-slate-900',
    descColor: 'text-slate-500',
  },
  {
    icon: Briefcase,
    label: 'שירותים',
    desc: 'לוגיסטיקה, הסעות ושירותי תמיכה',
    href: '/marketplace?category=services',
    accent: 'bg-emerald-500',
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-600',
    labelColor: 'text-slate-900',
    descColor: 'text-slate-500',
  },
  {
    icon: Store,
    label: 'כל המודעות',
    desc: 'עיון חופשי בכל הפרסומים',
    href: '/marketplace',
    accent: 'bg-navy-500',
    iconBg: 'bg-navy-100',
    iconColor: 'text-navy-600',
    labelColor: 'text-slate-900',
    descColor: 'text-slate-500',
  },
];

export default function HeroSection(_: HeroSectionProps) {
  const router = useRouter();
  const { isLoggedIn, entityType, refreshAuth } = useAuth();
  // Tracks which tile is currently hot-swapping its entity context.
  // Used to disable both buttons and show a spinner on the active one.
  const [switching, setSwitching] = useState<'contractor' | 'corporation' | null>(null);

  const dashboardOf = (role: 'contractor' | 'corporation') =>
    role === 'corporation' ? '/corporation/dashboard' : '/contractor/dashboard';
  const registerOf = (role: 'contractor' | 'corporation') =>
    role === 'corporation' ? '/register/corporation' : '/register/contractor';

  /**
   * Decide what should happen when the user clicks a role tile.
   *
   *   - Not logged in → kick to /login?intent=<role> (login auto-skips
   *     the entity-picker after auth).
   *   - Logged in *as that role* already → just route to its dashboard.
   *   - Logged in *as the other role* → fetch the user's memberships;
   *     if a matching one exists, hot-swap their JWT via select-entity
   *     so they land in the requested role without re-auth. If no
   *     matching membership exists, send them to the registration
   *     flow for that role.
   *   - Anything fails along the way → fall back to /login with intent
   *     so the user always has *some* path forward.
   */
  async function enterRole(role: 'contractor' | 'corporation') {
    if (!isLoggedIn) {
      router.push(`/login?intent=${role}`);
      return;
    }
    // Always fetch memberships so we can offer the picker to users
    // who have >1 entity of the requested role (e.g. multiple
    // contractor companies). Used to skip this when entityType
    // already matched — that silently locked the user into the
    // first contractor they had.
    setSwitching(role);
    try {
      const { memberships } = await otpApi.myMemberships();
      const matching = memberships.filter((m) => m.entity_type === role);
      if (matching.length === 0) {
        // Logged-in user clicked a role they don't have a membership
        // for — registration is the right next step.
        router.push(registerOf(role));
        return;
      }
      if (matching.length > 1) {
        // Multi-entity user: push to the picker so they can choose
        // which contractor / corporation account to act as. The
        // `force` flag tells select-entity to render the chooser
        // even when the intent matches multiple memberships
        // (default behaviour auto-picks the first).
        sessionStorage.setItem('pending_intent', role);
        sessionStorage.setItem('pending_memberships', JSON.stringify(memberships));
        router.push(`/select-entity?intent=${role}&force=1`);
        return;
      }
      // Exactly one matching membership.
      if (entityType === role) {
        // The user only has one entity of this role, so the current
        // entity context IS that one — skip the select-entity round-
        // trip and go straight to the dashboard.
        router.push(dashboardOf(role));
        return;
      }
      const tokens = await otpApi.selectEntity(matching[0].entity_id, matching[0].entity_type);
      saveTokens(tokens.access_token, tokens.refresh_token);
      refreshAuth();
      router.push(dashboardOf(role));
    } catch {
      router.push(`/login?intent=${role}`);
    } finally {
      setSwitching(null);
    }
  }

  // Hrefs are still set for SEO + right-click "open in new tab"
  // behavior, but the click handler intercepts to do the right thing
  // at runtime.
  const contractorCtaHref = !isLoggedIn
    ? '/login?intent=contractor'
    : dashboardOf('contractor');
  const corporationCtaHref = !isLoggedIn
    ? '/login?intent=corporation'
    : dashboardOf('corporation');

  return (
    <section className="relative flex flex-col overflow-hidden bg-white">
      {/* Subtle top-end orange glow — reduced opacity for white surface */}
      <div
        className="pointer-events-none absolute top-0 end-0 h-[480px] w-[480px] rounded-full opacity-[0.08]"
        style={{ background: 'radial-gradient(circle, #f78203 0%, transparent 70%)', transform: 'translate(30%, -30%)' }}
      />
      {/* Dot texture — dark dots on light surface */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{ backgroundImage: 'radial-gradient(circle, #0f172a 1px, transparent 1px)', backgroundSize: '32px 32px' }}
      />

      {/* ── Main hero content ── */}
      {/* Logged-in strip previously rendered here was redundant
          with LandingNav (which already shows name + admin link +
          logout when isLoggedIn). The duplicate buttons were
          stacking visually on the dark hero. LandingNav stays
          fixed-top across the whole page so it's the only place
          we need these controls. */}
      <div className="relative">
        <div className="max-w-6xl mx-auto px-6 w-full pt-28 pb-12">
          {/* Top: brand + headline + subtitle, centered */}
          <div className="text-center space-y-3 md:space-y-4 mb-10">
            {/* Brand lockup — single transparent asset (icon + wordmark
                in one image). Acts as both the visual brand mark and
                the H1 ranking signal via the alt text. */}
            <Image
              src="/brand/buildup-lockup.png?v=3"
              alt="BuildUp"
              width={500}
              height={400}
              className="mx-auto object-contain h-40 md:h-56 w-auto"
              priority
              unoptimized
            />

            <h1 className="text-3xl md:text-5xl font-extrabold leading-[1.15] tracking-tight text-slate-900 max-w-4xl mx-auto">
              הדרך החכמה לגייס
              <br className="hidden sm:block" />
              <span className="text-brand-600"> עובדים זרים</span>
            </h1>

            <p className="text-base md:text-lg text-slate-600 leading-relaxed max-w-2xl mx-auto">
              מערכת מבוססת AI להתאמת עובדים, שיבוץ וניהול תהליך הגיוס — במהירות, בפשטות ובזמן אמת.
            </p>
          </div>

          {/* Two tiles SIDE-BY-SIDE — contractor (find workers) + corporation (publish workers) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 max-w-5xl mx-auto">
            {/* Contractor tile — anchored on the active-workers stat */}
            <Link
              href={contractorCtaHref}
              onClick={(e) => { e.preventDefault(); enterRole('contractor'); }}
              aria-disabled={switching !== null}
              className={`group flex flex-col items-center justify-center text-center bg-white hover:bg-brand-50/40 border border-slate-200 hover:border-brand-400 rounded-3xl p-4 md:p-9 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${switching === 'contractor' ? 'opacity-80' : ''} ${switching && switching !== 'contractor' ? 'pointer-events-none opacity-50' : ''}`}
            >
              <div className="text-2xl md:text-4xl font-black text-brand-600 tracking-tight mb-2 md:mb-4">
                קבלן
              </div>
              <div className="h-9 w-9 md:h-12 md:w-12 rounded-2xl bg-brand-100 flex items-center justify-center mb-2 md:mb-4">
                <Users className="h-5 w-5 md:h-6 md:w-6 text-brand-600" />
              </div>
              <div className="text-3xl md:text-5xl font-extrabold text-slate-900 mb-1 group-hover:text-brand-700 transition-colors">
                {HERO_STAT.value}
              </div>
              <div className="text-xs md:text-sm text-slate-500 mb-3 md:mb-5">{HERO_STAT.label}</div>
              {/* CTA pill — bigger per QA-R3 #31 so the next step pops on
                  the page; smaller padding on mobile (R3 #32) so the tile
                  itself isn't too tall to scroll past. */}
              <div className="inline-flex items-center gap-2 px-6 md:px-8 py-3 md:py-4 rounded-full bg-brand-600 text-base md:text-lg font-bold text-white shadow-md group-hover:bg-brand-700 transition-colors">
                {switching === 'contractor'
                  ? <><Loader2 className="h-5 w-5 animate-spin" /> מעביר...</>
                  : <>חפש עובדים<ArrowLeft className="h-5 w-5 group-hover:-translate-x-1 transition-transform" /></>}
              </div>
            </Link>

            {/* Corporation tile — invite manpower corporations to publish */}
            <Link
              href={corporationCtaHref}
              onClick={(e) => { e.preventDefault(); enterRole('corporation'); }}
              aria-disabled={switching !== null}
              className={`group flex flex-col items-center justify-center text-center bg-white hover:bg-navy-50/40 border border-slate-200 hover:border-navy-400 rounded-3xl p-4 md:p-9 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${switching === 'corporation' ? 'opacity-80' : ''} ${switching && switching !== 'corporation' ? 'pointer-events-none opacity-50' : ''}`}
            >
              <div className="text-2xl md:text-4xl font-black text-navy-600 tracking-tight mb-2 md:mb-4">
                תאגיד
              </div>
              <div className="h-9 w-9 md:h-12 md:w-12 rounded-2xl bg-navy-100 flex items-center justify-center mb-2 md:mb-4">
                <Building2 className="h-5 w-5 md:h-6 md:w-6 text-navy-600" />
              </div>
              <div className="text-sm md:text-lg text-slate-900 font-semibold leading-snug mb-2 md:mb-3 max-w-sm">
                עשרות קבלנים כבר מנויים לשירותים שלנו ומחפשים עובדים
              </div>
              <div className="text-base md:text-xl text-navy-600 font-bold leading-snug mb-3 md:mb-5">
                מנהל תאגיד — אל תישאר בחוץ
              </div>
              <div className="inline-flex items-center gap-2 px-6 md:px-8 py-3 md:py-4 rounded-full bg-navy-600 text-base md:text-lg font-bold text-white shadow-md group-hover:bg-navy-700 transition-colors">
                {switching === 'corporation'
                  ? <><Loader2 className="h-5 w-5 animate-spin" /> מעביר...</>
                  : <>פרסם זמינות<ArrowLeft className="h-5 w-5 group-hover:-translate-x-1 transition-transform" /></>}
              </div>
            </Link>
          </div>
        </div>
      </div>

      {/* ── Marketplace quick-access bar ── */}
      <div className="relative border-t border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">
            שירותים נלווים — גלוש ישירות לפי קטגוריה
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {MARKET_CATS.map(({ icon: Icon, label, desc, href, accent, iconBg, iconColor, labelColor, descColor }) => (
              <Link
                key={href}
                href={href}
                className="group flex flex-col bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-2xl overflow-hidden shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
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

      {/* Scroll cue removed per QA — the marketplace category bar already
          provides visible content below the fold, so the cue was sitting
          mid-page without adding value (R1 #4). */}
    </section>
  );
}
