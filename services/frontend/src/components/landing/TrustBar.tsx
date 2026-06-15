import { Zap, Users, Award, ShieldCheck, type LucideIcon } from 'lucide-react';

// "Why choose BuildUp" — four award-style stat badges. Each is a
// shield shape (SVG path) with a floating circular emblem on top, a
// big stat number, a one-line label, and a small laurel inside the
// shield. A soft colored glow sits behind every card to give the
// section that "trophy room" feel.
//
// Layout follows the mockup order RIGHT→LEFT (RTL reading direction):
//
//   ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐
//   │ 3 שניות │  │ +1,200  │  │ 48 שעות │  │  100%   │
//   │התאמה חכמה│  │עובדים פעילים│  │אימות ממוצע│  │מאומתים ברישיון│
//   └────────┘  └────────┘  └────────┘  └────────┘
//
// Badge palette is locked to the four design colours from the mockup;
// the spec orange (#F7941D) and navy (#1A2B4A) are reused from the
// HowItWorks tokens for cross-section coherence. The emerald + peach
// in the middle two badges are local to this section.

interface Badge {
  icon: LucideIcon;
  value: string;
  label: string;
  /** Primary colour — used for the shield stroke, stat number, and
   *  the emblem accent (icon when the emblem is light, or stroke
   *  ring when the emblem is filled). */
  primary: string;
  /** Soft RGBA glow rendered behind the badge. */
  glow: string;
  /** Shield interior fill — a tint of the primary so the card has
   *  some warmth without being loud. */
  fill: string;
  /** Emblem (top circle) styling — `bg` and `iconColor`. Two
   *  patterns appear in the mockup: filled emblems with a white
   *  icon (badges 2 + 3) and light emblems with a coloured icon
   *  (badges 1 + 4). */
  emblemBg: string;
  emblemIcon: string;
}

const BADGES: Badge[] = [
  // Position 1 — right edge in RTL
  {
    icon: Zap,
    value: '3 שניות',
    label: 'התאמה חכמה',
    primary: '#F7941D',
    glow: 'rgba(247, 148, 29, 0.22)',
    fill: '#FFF7EC',
    emblemBg: '#FFFFFF',
    emblemIcon: '#F7941D',
  },
  // Position 2
  {
    icon: Users,
    value: '+1,200',
    label: 'עובדים פעילים',
    primary: '#1A2B4A',
    glow: 'rgba(26, 43, 74, 0.20)',
    fill: '#F4F6FB',
    emblemBg: '#1A2B4A',
    emblemIcon: '#FFFFFF',
  },
  // Position 3
  {
    icon: Award,
    value: '48 שעות',
    label: 'אימות ממוצע',
    primary: '#059669',
    glow: 'rgba(5, 150, 105, 0.20)',
    fill: '#EFFAF4',
    emblemBg: '#059669',
    emblemIcon: '#FFFFFF',
  },
  // Position 4 — left edge in RTL
  {
    icon: ShieldCheck,
    value: '100%',
    label: 'מאומתים ברישיון',
    primary: '#F7941D',
    glow: 'rgba(247, 148, 29, 0.18)',
    fill: '#FFF7EC',
    // Peach emblem with orange icon — visually paired with badge 1
    // but inverted (light icon-on-white vs. icon-on-peach) so the
    // row reads as "two oranges that frame the navy + emerald in the
    // middle" rather than as identical twins.
    emblemBg: '#FCE4C4',
    emblemIcon: '#F7941D',
  },
];

// Laurel was removed — it ate vertical space without earning its
// keep visually, especially after the badges were shrunk down. The
// trophy/award identity is now carried entirely by the shield shape
// + emblem.

function StatBadge({ badge }: { badge: Badge }) {
  const Icon = badge.icon;
  // Differentiate the emblem treatment: filled emblems get an inner
  // shadow + brighter outer ring; light emblems get a thin coloured
  // ring around the white background.
  const isFilledEmblem = badge.emblemBg !== '#FFFFFF' && badge.emblemBg !== '#FCE4C4';

  return (
    <div className="relative flex flex-col items-center">
      {/* Emblem (top circle) — sits half-on-top of the shield. Shrunk
          to 36px (was 44 → 52 → 72) so the medallion really reads as
          a small finishing detail. Glow background was removed; with
          the smaller shields the page no longer needs it for warmth. */}
      <div
        className="relative z-10 flex items-center justify-center"
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: badge.emblemBg,
          border: isFilledEmblem ? `2px solid ${badge.primary}` : `1.5px solid ${badge.primary}33`,
          boxShadow: isFilledEmblem
            ? `0 3px 8px ${badge.glow}, inset 0 -2px 4px rgba(0,0,0,0.18)`
            : `0 3px 8px ${badge.glow}`,
          marginBottom: -16,
        }}
      >
        <Icon size={16} color={badge.emblemIcon} strokeWidth={2.2} />
      </div>

      {/* Shield — squat aspect ratio (100×95, was 100×130) so the
          card is wider than tall. The text overlay stays at its fixed
          inline font-sizes, but with less vertical real estate to fill
          the badge no longer feels oversized. Path tail is also
          flatter to match the new ratio. */}
      <div className="relative w-full" style={{ aspectRatio: '100 / 95' }}>
        <svg
          viewBox="0 0 100 95"
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full"
        >
          <path
            d="M 18 0 H 82 Q 100 0 100 18 V 70 Q 100 80 90 84 L 56 92 Q 50 94 44 92 L 10 84 Q 0 80 0 70 V 18 Q 0 0 18 0 Z"
            fill={badge.fill}
            stroke={badge.primary}
            strokeWidth="2"
          />
        </svg>

        {/* Content overlay — text sizes preserved per user request
            (stat 20px, label 11px). Inner padding tightened to the
            new height. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pt-4 pb-3 px-2 text-center">
          <div
            style={{ color: badge.primary, fontSize: 20, fontWeight: 600, lineHeight: 1, marginBottom: 2 }}
          >
            {badge.value}
          </div>
          <div
            style={{ color: '#1A2B4A', fontSize: 11, fontWeight: 500, lineHeight: 1.2 }}
          >
            {badge.label}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TrustBar() {
  return (
    // Tightened further: pt-2 pb-8 (was pt-4 pb-10). The shrunk badges
    // also let the corner glow blobs disappear without weakening the
    // section — keeping them only as the subtle bottom-start one.
    <section id="trust-bar" dir="rtl" className="bg-white pt-2 pb-8 relative overflow-hidden">
      {/* Decorative orange spark glints at the edges — gives the
          section that "premium / award" feel without forcing a hero
          background. Kept very subtle so they read as accents not
          content. */}
      {/* Top corner glow removed — the smaller badges + smaller
          headline don't need the extra ambient warmth. Bottom-start
          glow kept (very subtle) so the section doesn't feel
          completely flat against HowItWorks below. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-12 -start-12 h-48 w-48 rounded-full opacity-20"
        style={{ background: 'radial-gradient(circle, rgba(247,148,29,0.20) 0%, transparent 70%)' }}
      />

      <div className="relative max-w-3xl mx-auto px-4 sm:px-6">
        {/* Header */}
        <div className="text-center mb-5">
          <p
            className="uppercase mb-1.5"
            style={{ color: '#F7941D', fontSize: 11, fontWeight: 500, letterSpacing: '0.12em' }}
          >
            למה בוחרים ב-TAGIDAI?
          </p>
          <h2
            className="text-lg sm:text-xl md:text-2xl"
            style={{ color: '#1A2B4A', fontWeight: 600, lineHeight: 1.25 }}
          >
            הפלטפורמה שמאיצה גיוס וסוגרת עסקאות
          </h2>
        </div>

        {/* Badge row — 4 columns on md+, 2 columns on mobile. Container
            capped at max-w-3xl (down from 4xl/6xl) so the badges keep
            their reduced footprint on wide screens. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mt-6">
          {BADGES.map((badge) => (
            <StatBadge key={badge.label} badge={badge} />
          ))}
        </div>
      </div>
    </section>
  );
}
