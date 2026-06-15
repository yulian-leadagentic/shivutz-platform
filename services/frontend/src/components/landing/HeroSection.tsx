'use client';

import Image from 'next/image';
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

// The fixed "שירותים נלווים — גלוש לפי קטגוריה" row that used to live
// here was replaced by <LiveShowcase /> below — the dynamic showcase
// covers the whole platform breadth (workers, requirements, housing,
// services, matches) rather than just the marketplace categories, and
// auto-rotates so the page feels alive on first scroll.
//
// The 1,200+ active-workers stat that used to anchor the contractor
// tile is now rendered inside <LiveShowcase /> as part of the combined
// Live + tile card.

export default function HeroSection(_: HeroSectionProps) {
  // Role-tile rendering + click handling (enterRole, switching state,
  // hrefs, etc.) moved into <LiveShowcase /> below — it owns the
  // combined Live + role tile cards now. HeroSection is reduced to
  // the headline + the showcase render. If you need to bring back
  // standalone role tiles, the previous implementation is in git
  // history pre-cleanup-commit on the staging branch.

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

      {/* ── Header: logo + headline + subtitle ── */}
      {/* Top padding trimmed (pt-20→pt-14, md:pt-24→pt-16) so the live
          showcase + role tiles can fit in one viewport on common
          phones. Bottom padding gone — LiveShowcase below carries its
          own band. */}
      <div className="relative">
        <div className="max-w-6xl mx-auto px-6 w-full pt-14 md:pt-16 pb-3 md:pb-4">
          <div className="text-center space-y-1.5 md:space-y-2">
            <Image
              src="/brand/buildup-lockup.png?v=4"
              alt="TagidAI"
              width={500}
              height={400}
              className="mx-auto object-contain h-16 md:h-24 w-auto"
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
        </div>
      </div>

      {/* ── Live showcase ── the merged variant (Live + role tile fused
          into a single combined card per role) is the only Live surface
          on the hero. Click handling, role tile content, and the
          rotating Live message all live inside this component. */}
      <LiveShowcase />

    </section>
  );
}
