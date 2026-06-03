'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Users, Building2, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { otpApi } from '@/lib/api';
import { saveTokens } from '@/lib/auth';
import LiveShowcase from './LiveShowcase';

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

// The fixed "שירותים נלווים — גלוש לפי קטגוריה" row that used to live
// here was replaced by <LiveShowcase /> below — the dynamic showcase
// covers the whole platform breadth (workers, requirements, housing,
// services, matches) rather than just the marketplace categories, and
// auto-rotates so the page feels alive on first scroll.

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
      {/* Sized down per QA: the lockup + headline were eating 50%+ of
          the above-the-fold real estate before the role tiles got a
          chance to be seen. Logo halved (h-40 → h-20), H1 dropped a
          tier (md:text-5xl → md:text-3xl), subtitle shrunk + max-width
          tightened. Top padding pulled in too. */}
      <div className="relative">
        <div className="max-w-6xl mx-auto px-6 w-full pt-20 md:pt-24 pb-8 md:pb-12">
          {/* Top: brand + headline + subtitle, centered */}
          <div className="text-center space-y-2 md:space-y-3 mb-6 md:mb-8">
            <Image
              src="/brand/buildup-lockup.png?v=3"
              alt="BuildUp"
              width={500}
              height={400}
              className="mx-auto object-contain h-20 md:h-28 w-auto"
              priority
              unoptimized
            />

            <h1 className="text-lg md:text-3xl font-extrabold leading-[1.25] tracking-tight text-slate-900 max-w-3xl mx-auto">
              פלטפורמת השיבוץ הראשונה בישראל
              <br className="hidden sm:block" />
              <span className="text-brand-600"> לעובדים זרים בענף הבנייה</span>
            </h1>

            <p className="text-xs md:text-sm text-slate-600 leading-relaxed max-w-xl mx-auto">
              מערכת מבוססת AI להתאמת עובדים, שיבוץ וניהול תהליך הגיוס — במהירות, בפשטות ובזמן אמת.
            </p>
          </div>

          {/* Two tiles SIDE-BY-SIDE on every breakpoint — mobile users
              should see both choices at the same time so they can pick
              which role they're entering without scrolling. The narrow
              mobile width is absorbed by tighter padding + smaller
              type; the CTA buttons drop their gap + wrap if necessary. */}
          <div className="grid grid-cols-2 gap-3 md:gap-6 max-w-5xl mx-auto">
            {/* Contractor tile — anchored on the active-workers stat */}
            <Link
              href={contractorCtaHref}
              onClick={(e) => { e.preventDefault(); enterRole('contractor'); }}
              aria-disabled={switching !== null}
              className={`group flex flex-col items-center justify-center text-center bg-white hover:bg-brand-50/40 border border-slate-200 hover:border-brand-400 rounded-2xl md:rounded-3xl p-3 md:p-9 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${switching === 'contractor' ? 'opacity-80' : ''} ${switching && switching !== 'contractor' ? 'pointer-events-none opacity-50' : ''}`}
            >
              <div className="text-xl md:text-4xl font-black text-brand-600 tracking-tight mb-1.5 md:mb-4">
                קבלן
              </div>
              <div className="h-8 w-8 md:h-12 md:w-12 rounded-xl md:rounded-2xl bg-brand-100 flex items-center justify-center mb-1.5 md:mb-4">
                <Users className="h-4 w-4 md:h-6 md:w-6 text-brand-600" />
              </div>
              <div className="text-2xl md:text-5xl font-extrabold text-slate-900 leading-none mb-1 group-hover:text-brand-700 transition-colors">
                {HERO_STAT.value}
              </div>
              <div className="text-[11px] md:text-sm text-slate-500 mb-2 md:mb-5">{HERO_STAT.label}</div>
              {/* CTA pill — bigger per QA-R3 #31 so the next step pops on
                  the page; smaller padding on mobile (R3 #32) so the tile
                  itself isn't too tall to scroll past. */}
              <div className="inline-flex items-center gap-1 md:gap-2 px-3 md:px-8 py-2 md:py-4 rounded-full bg-brand-600 text-sm md:text-lg font-bold text-white shadow-md group-hover:bg-brand-700 transition-colors">
                {switching === 'contractor'
                  ? <><Loader2 className="h-4 w-4 md:h-5 md:w-5 animate-spin" /> מעביר...</>
                  : <>חפש עובדים<ArrowLeft className="h-4 w-4 md:h-5 md:w-5 group-hover:-translate-x-1 transition-transform" /></>}
              </div>
            </Link>

            {/* Corporation tile — invite manpower corporations to publish */}
            <Link
              href={corporationCtaHref}
              onClick={(e) => { e.preventDefault(); enterRole('corporation'); }}
              aria-disabled={switching !== null}
              className={`group flex flex-col items-center justify-center text-center bg-white hover:bg-navy-50/40 border border-slate-200 hover:border-navy-400 rounded-2xl md:rounded-3xl p-3 md:p-9 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${switching === 'corporation' ? 'opacity-80' : ''} ${switching && switching !== 'corporation' ? 'pointer-events-none opacity-50' : ''}`}
            >
              <div className="text-xl md:text-4xl font-black text-navy-600 tracking-tight mb-1.5 md:mb-4">
                תאגיד
              </div>
              <div className="h-8 w-8 md:h-12 md:w-12 rounded-xl md:rounded-2xl bg-navy-100 flex items-center justify-center mb-1.5 md:mb-4">
                <Building2 className="h-4 w-4 md:h-6 md:w-6 text-navy-600" />
              </div>
              {/* Description trimmed to one short line on mobile so the
                  tile height roughly matches the contractor tile and
                  both CTAs line up. The fuller copy stays on desktop. */}
              <div className="text-xs md:text-lg text-slate-900 font-semibold leading-snug mb-1 md:mb-3 max-w-sm">
                <span className="md:hidden">קבלנים פעילים מחפשים עובדים</span>
                <span className="hidden md:inline">עשרות קבלנים כבר מנויים לשירותים שלנו ומחפשים עובדים</span>
              </div>
              <div className="text-xs md:text-xl text-navy-600 font-bold leading-snug mb-2 md:mb-5">
                <span className="md:hidden">אל תישאר בחוץ</span>
                <span className="hidden md:inline">מנהל תאגיד — אל תישאר בחוץ</span>
              </div>
              <div className="inline-flex items-center gap-1 md:gap-2 px-3 md:px-8 py-2 md:py-4 rounded-full bg-navy-600 text-sm md:text-lg font-bold text-white shadow-md group-hover:bg-navy-700 transition-colors">
                {switching === 'corporation'
                  ? <><Loader2 className="h-4 w-4 md:h-5 md:w-5 animate-spin" /> מעביר...</>
                  : <>פרסם עובדים<ArrowLeft className="h-4 w-4 md:h-5 md:w-5 group-hover:-translate-x-1 transition-transform" /></>}
              </div>
            </Link>
          </div>
        </div>
      </div>

      {/* Inline live-activity showcase — replaces the previous static
          "שירותים נלווים — גלוש לפי קטגוריה" row. Rotates every ~5s
          (jittered to feel organic) and covers the platform breadth:
          workers, requirements, housing, services, matches, etc. */}
      <LiveShowcase />

    </section>
  );
}
