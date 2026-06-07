'use client';

// LiveShowcaseMerged — Live mini-strip fused INTO the role tile so each
// role has a single combined card (Live message on top, role CTA below)
// rather than four separate boxes. The whole card is one click target.
//
//   ┌───────────────────────────────┐  ┌───────────────────────────────┐
//   │ ●LIVE לקבלן · עובדים זמינים  │  │ ●LIVE לתאגיד · דרישה חדשה    │
//   │ 250 מומחי בנייה ב-3 אזורים    │  │ 50 שלדים לאזור המרכז          │
//   │ ─────────────────────────────  │  │ ─────────────────────────────  │
//   │           קבלן                 │  │          תאגיד                │
//   │           👥                   │  │           🏢                  │
//   │        1,200+                  │  │  קבלנים מחפשים עובדים         │
//   │     עובדים פעילים              │  │  אל תישאר בחוץ                │
//   │     [חפש עובדים →]            │  │     [פרסם עובדים →]            │
//   └───────────────────────────────┘  └───────────────────────────────┘
//
// Replaces both the Live section AND the separate role-tile grid below.
// HeroSection conditionally skips the role-tiles div when this variant
// is active.
//
// Click contract — for both halves of a card:
//   - Anon visitor      → /login?intent=<role>
//   - Logged-in matching → /<role>/dashboard
//   - Logged-in other    → hot-swap entity via enterRole()
// The role-choice modal is bypassed entirely (the role is implicit in
// which card was clicked).

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Users, Building2, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { otpApi } from '@/lib/api';
import { saveTokens } from '@/lib/auth';
import { LiveStripContent, useRoleLiveStrip } from '@/features/live-activity/RoleLiveStrip';
import type { RoleSide } from '@/features/live-activity/RoleLiveStrip';

const HERO_STAT = { value: '1,200+', label: 'עובדים פעילים' };

interface CombinedCardProps {
  side: RoleSide;
  ctaHref: string;
  switching: 'contractor' | 'corporation' | null;
  onClick: () => void;
}

function CombinedCard({ side, ctaHref, switching, onClick }: CombinedCardProps) {
  const isContractor = side === 'contractor';
  const { current, pause, resume } = useRoleLiveStrip(side);

  const cardClasses = isContractor
    ? 'border-brand-200 bg-white hover:border-brand-400 hover:shadow-brand-200/40 shadow-brand-100/40'
    : 'border-navy-200 bg-white hover:border-navy-400 hover:shadow-navy-200/40 shadow-navy-100/40';

  const liveAreaBg = isContractor ? 'bg-brand-50/40' : 'bg-navy-50/40';
  const divider    = isContractor ? 'border-brand-100' : 'border-navy-100';

  const isSwitching = switching === side;
  const isOtherSwitching = switching !== null && switching !== side;

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    onClick();
  }

  return (
    <Link
      href={ctaHref}
      onClick={handleClick}
      onMouseEnter={pause}
      onMouseLeave={resume}
      aria-disabled={switching !== null}
      aria-label={isContractor ? 'כניסה כקבלן' : 'כניסה כתאגיד'}
      className={`group block rounded-2xl md:rounded-3xl border-2 shadow-md transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 cursor-pointer overflow-hidden ${cardClasses} ${isSwitching ? 'opacity-80' : ''} ${isOtherSwitching ? 'pointer-events-none opacity-50' : ''}`}
    >
      {/* ── Live mini-strip (top half) ──────────────────────────────── */}
      <div className={`${liveAreaBg} border-b ${divider}`}>
        {current && <LiveStripContent side={side} current={current} compact />}
      </div>

      {/* ── Role tile (bottom half) — content mirrors HeroSection's
           original tile design but rendered inside the merged card,
           without its own click handler (parent <Link> owns it). ── */}
      {isContractor ? (
        <div className="flex flex-col items-center text-center p-2.5 md:p-5">
          <div className="text-lg md:text-3xl font-black text-brand-600 tracking-tight mb-1 md:mb-2">
            קבלן
          </div>
          <div className="h-7 w-7 md:h-10 md:w-10 rounded-xl bg-brand-100 flex items-center justify-center mb-1 md:mb-2">
            <Users className="h-3.5 w-3.5 md:h-5 md:w-5 text-brand-600" />
          </div>
          <div className="text-xl md:text-4xl font-extrabold text-slate-900 leading-none mb-0.5 group-hover:text-brand-700 transition-colors">
            {HERO_STAT.value}
          </div>
          <div className="text-[11px] md:text-sm text-slate-500 mb-1.5 md:mb-3">{HERO_STAT.label}</div>
          <div className="inline-flex items-center gap-1 md:gap-2 px-3 md:px-6 py-1.5 md:py-2.5 rounded-full bg-brand-600 text-xs md:text-base font-bold text-white shadow-md group-hover:bg-brand-700 transition-colors">
            {isSwitching
              ? <><Loader2 className="h-3.5 w-3.5 md:h-4 md:w-4 animate-spin" /> מעביר...</>
              : <>חפש עובדים<ArrowLeft className="h-3.5 w-3.5 md:h-4 md:w-4 group-hover:-translate-x-1 transition-transform" /></>}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center text-center p-2.5 md:p-5">
          <div className="text-lg md:text-3xl font-black text-navy-600 tracking-tight mb-1 md:mb-2">
            תאגיד
          </div>
          <div className="h-7 w-7 md:h-10 md:w-10 rounded-xl bg-navy-100 flex items-center justify-center mb-1 md:mb-2">
            <Building2 className="h-3.5 w-3.5 md:h-5 md:w-5 text-navy-600" />
          </div>
          <div className="text-xs md:text-base text-slate-900 font-semibold leading-snug mb-0.5 md:mb-1.5 max-w-sm">
            <span className="md:hidden">קבלנים פעילים מחפשים עובדים</span>
            <span className="hidden md:inline">עשרות קבלנים כבר מנויים לשירותים שלנו ומחפשים עובדים</span>
          </div>
          <div className="text-xs md:text-lg text-navy-600 font-bold leading-snug mb-1.5 md:mb-3">
            <span className="md:hidden">אל תישאר בחוץ</span>
            <span className="hidden md:inline">מנהל תאגיד — אל תישאר בחוץ</span>
          </div>
          <div className="inline-flex items-center gap-1 md:gap-2 px-3 md:px-6 py-1.5 md:py-2.5 rounded-full bg-navy-600 text-xs md:text-base font-bold text-white shadow-md group-hover:bg-navy-700 transition-colors">
            {isSwitching
              ? <><Loader2 className="h-3.5 w-3.5 md:h-4 md:w-4 animate-spin" /> מעביר...</>
              : <>פרסם עובדים<ArrowLeft className="h-3.5 w-3.5 md:h-4 md:w-4 group-hover:-translate-x-1 transition-transform" /></>}
          </div>
        </div>
      )}
    </Link>
  );
}

export default function LiveShowcaseMerged() {
  const router = useRouter();
  const { isLoggedIn, entityType, refreshAuth } = useAuth();
  const [switching, setSwitching] = useState<'contractor' | 'corporation' | null>(null);

  const dashboardOf = (role: RoleSide) =>
    role === 'corporation' ? '/corporation/dashboard' : '/contractor/dashboard';
  const registerOf = (role: RoleSide) =>
    role === 'corporation' ? '/register/corporation' : '/register/contractor';

  // Same enterRole logic as HeroSection — hot-swaps entity context for
  // logged-in users with a matching membership, falls back to login or
  // registration otherwise. Duplicated here because the merged variant
  // is self-contained; refactoring HeroSection to share isn't worth the
  // churn while the A/B is still in flight.
  async function enterRole(role: RoleSide) {
    if (!isLoggedIn) {
      router.push(`/login?intent=${role}`);
      return;
    }
    setSwitching(role);
    try {
      const { memberships } = await otpApi.myMemberships();
      const matching = memberships.filter((m) => m.entity_type === role);
      if (matching.length === 0) {
        router.push(registerOf(role));
        return;
      }
      if (matching.length > 1) {
        router.push(`/select-entity?intent=${role}`);
        return;
      }
      const tokens = await otpApi.selectEntity(matching[0].entity_id, role);
      saveTokens(tokens.access_token, tokens.refresh_token);
      refreshAuth();
      router.push(dashboardOf(role));
    } catch {
      router.push(`/login?intent=${role}`);
    } finally {
      setSwitching(null);
    }
  }

  const contractorHref = !isLoggedIn
    ? '/login?intent=contractor'
    : (entityType === 'contractor' ? dashboardOf('contractor') : '/login?intent=contractor');
  const corporationHref = !isLoggedIn
    ? '/login?intent=corporation'
    : (entityType === 'corporation' ? dashboardOf('corporation') : '/login?intent=corporation');

  return (
    <section
      aria-label="פעילות חיה — בחירת תפקיד"
      className="relative bg-rose-50/40"
    >
      <div className="max-w-6xl mx-auto px-6 w-full py-3 sm:py-4">
        <div className="max-w-5xl mx-auto">
          {/* No section header — the LIVE pill inside each card carries
              the liveness signal per-role, and a duplicate header band
              just adds visual noise. Cards go straight under the hero
              copy with the rose-tinted section background as the only
              visual divider. */}

          {/* Two combined cards. Grid identical to the original role-tiles
              wrapper so the page footprint is unchanged. */}
          <div className="grid grid-cols-2 gap-3 md:gap-6">
            <CombinedCard
              side="contractor"
              ctaHref={contractorHref}
              switching={switching}
              onClick={() => enterRole('contractor')}
            />
            <CombinedCard
              side="corporation"
              ctaHref={corporationHref}
              switching={switching}
              onClick={() => enterRole('corporation')}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
