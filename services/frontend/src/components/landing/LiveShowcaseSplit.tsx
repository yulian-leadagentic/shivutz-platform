'use client';

// LiveShowcaseSplit — A/B-test variant of the Live section.
//
// Two side-by-side strips, one above each role tile. Each strip rotates
// only categories relevant to ITS role and routes the click straight to
// /login?intent=<role> (no role-choice modal).
//
//   ┌──────────────────────────────┬──────────────────────────────┐
//   │ ● LIVE — לקבלן               │ ● LIVE — לתאגיד              │
//   │ עובדים זמינים…               │ דרישה חדשה…                  │
//   └──────────────────────────────┴──────────────────────────────┘
//   ┌──────────────────────────────┬──────────────────────────────┐
//   │ [קבלן tile]                  │ [תאגיד tile]                 │
//   └──────────────────────────────┴──────────────────────────────┘
//
// The unified rotating card lives in LiveShowcase.tsx; the merged
// (Live + tile fused) variant lives in LiveShowcaseMerged.tsx. All
// three are preserved untouched — HeroSection picks between them via a
// `?live=` query param for moderated user tests.

import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { LiveStripContent, useRoleLiveStrip } from '@/features/live-activity/RoleLiveStrip';
import type { RoleSide } from '@/features/live-activity/RoleLiveStrip';

interface StripProps {
  side: RoleSide;
  /** Default 5000ms; jitter applied inside the hook. */
  intervalMs?: number;
  /** Where the click navigates — depends on auth state. */
  ctaHref: string;
}

function LiveStrip({ side, intervalMs = 5000, ctaHref }: StripProps) {
  const router = useRouter();
  const { current, pause, resume } = useRoleLiveStrip(side, intervalMs);

  const isContractor = side === 'contractor';
  const cardClasses = isContractor
    ? 'border-brand-200 bg-white hover:border-brand-400 hover:shadow-brand-200/40 shadow-brand-100/40'
    : 'border-navy-200 bg-white hover:border-navy-400 hover:shadow-navy-200/40 shadow-navy-100/40';

  function handleClick() {
    router.push(ctaHref);
  }

  if (!current) {
    return <div className="rounded-2xl border-2 border-transparent h-[88px] sm:h-[104px]" aria-hidden />;
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseEnter={pause}
      onMouseLeave={resume}
      aria-label={isContractor ? 'כניסה כקבלן' : 'כניסה כתאגיד'}
      className={`block w-full text-start rounded-2xl border-2 shadow-md transition-all cursor-pointer hover:shadow-lg ${cardClasses}`}
    >
      <LiveStripContent side={side} current={current} />
    </button>
  );
}

interface Props {
  /** Default 5000ms; jitter applied so the two sides drift apart. */
  intervalMs?: number;
}

export default function LiveShowcaseSplit({ intervalMs = 5000 }: Props) {
  const { isLoggedIn, entityType } = useAuth();

  const contractorHref = isLoggedIn && entityType === 'contractor'
    ? '/contractor/dashboard'
    : '/login?intent=contractor';
  const corporationHref = isLoggedIn && entityType === 'corporation'
    ? '/corporation/dashboard'
    : '/login?intent=corporation';

  return (
    <section
      aria-label="פעילות חיה בפלטפורמה"
      className="relative bg-rose-50/40"
    >
      <div className="max-w-6xl mx-auto px-6 w-full py-3 sm:py-4">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-500 text-white text-xs font-bold tracking-wide shadow-sm">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-white animate-live-dot" />
                LIVE
              </span>
              <span className="text-sm font-semibold text-slate-800">מה קורה עכשיו ב-BuildUp</span>
            </div>
            <p className="text-xs text-slate-500 leading-snug hidden sm:block">
              לחץ על ההודעה הרלוונטית לך והיכנס ישירות
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 md:gap-6">
            <LiveStrip side="contractor"  intervalMs={intervalMs} ctaHref={contractorHref} />
            <LiveStrip side="corporation" intervalMs={intervalMs} ctaHref={corporationHref} />
          </div>
        </div>
      </div>
    </section>
  );
}
