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

// Small decorative laurel that sits at the bottom of each shield.
// Sized down from the first pass — the badges were dominating the
// page; the laurel needs to read as a finishing flourish, not its
// own focal point.
function Laurel({ color }: { color: string }) {
  return (
    <svg
      viewBox="-30 -8 60 16"
      width="36"
      height="9"
      aria-hidden="true"
    >
      <g stroke={color} strokeWidth="1" fill="none" strokeLinecap="round">
        <path d="M -22 -2 Q -12 2 -2 0" />
        <ellipse cx="-18" cy="-3" rx="1.8" ry="0.7" fill={color} stroke="none" />
        <ellipse cx="-12" cy="-3.5" rx="2" ry="0.8" fill={color} stroke="none" />
        <ellipse cx="-6" cy="-3" rx="1.8" ry="0.7" fill={color} stroke="none" />
        <path d="M 22 -2 Q 12 2 2 0" />
        <ellipse cx="18" cy="-3" rx="1.8" ry="0.7" fill={color} stroke="none" />
        <ellipse cx="12" cy="-3.5" rx="2" ry="0.8" fill={color} stroke="none" />
        <ellipse cx="6" cy="-3" rx="1.8" ry="0.7" fill={color} stroke="none" />
        <path d="M 0 -3 L 1.2 0 L 0 3 L -1.2 0 Z" fill={color} stroke="none" />
      </g>
    </svg>
  );
}

function StatBadge({ badge }: { badge: Badge }) {
  const Icon = badge.icon;
  // Differentiate the emblem treatment: filled emblems get an inner
  // shadow + brighter outer ring; light emblems get a thin coloured
  // ring around the white background.
  const isFilledEmblem = badge.emblemBg !== '#FFFFFF' && badge.emblemBg !== '#FCE4C4';

  return (
    <div className="relative flex flex-col items-center">
      {/* Soft coloured glow behind the whole badge */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-[-8px] inset-y-[-6px] blur-xl"
        style={{ background: badge.glow, borderRadius: '999px' }}
      />

      {/* Emblem (top circle) — sits half-on-top of the shield. Now
          44px (was 52, originally 72). Each shrink iteration also
          requires bumping the content-overlay top padding down to
          keep the stat number visually centered in the shield. */}
      <div
        className="relative z-10 flex items-center justify-center"
        style={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: badge.emblemBg,
          border: isFilledEmblem ? `2px solid ${badge.primary}` : `1.5px solid ${badge.primary}33`,
          boxShadow: isFilledEmblem
            ? `0 5px 12px ${badge.glow}, inset 0 -2px 5px rgba(0,0,0,0.18)`
            : `0 4px 10px ${badge.glow}`,
          marginBottom: -20,
        }}
      >
        <Icon size={18} color={badge.emblemIcon} strokeWidth={2.2} />
      </div>

      {/* Shield body — SVG so the shape (rounded top + tapered point) is
          crisp and the stroke is consistent. The 100x130 viewBox is
          stretched by width via preserveAspectRatio="none" so the badge
          adapts to its column width without distorting the corner
          radii noticeably. Content (stat + label + laurel) is layered
          above with absolute positioning. */}
      <div className="relative w-full" style={{ aspectRatio: '100 / 130' }}>
        <svg
          viewBox="0 0 100 130"
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full"
        >
          <path
            d="M 22 0 H 78 Q 100 0 100 22 V 92 Q 100 106 90 112 L 56 127 Q 50 130 44 127 L 10 112 Q 0 106 0 92 V 22 Q 0 0 22 0 Z"
            fill={badge.fill}
            stroke={badge.primary}
            strokeWidth="2"
          />
        </svg>

        {/* Content overlay — sizes pulled in another step. Stat
            24→20, label 12→11. Top padding shrinks with the emblem. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pt-5 pb-4 px-2 text-center">
          <div
            style={{ color: badge.primary, fontSize: 20, fontWeight: 600, lineHeight: 1, marginBottom: 3 }}
          >
            {badge.value}
          </div>
          <div
            style={{ color: '#1A2B4A', fontSize: 11, fontWeight: 500, lineHeight: 1.2 }}
          >
            {badge.label}
          </div>
          <div className="mt-1.5">
            <Laurel color={badge.primary} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TrustBar() {
  return (
    // pt-4 (was py-16) crunches the gap to the LiveShowcase banner
    // above; pb-10 keeps a comfortable gap before "איך זה עובד" below.
    <section id="trust-bar" dir="rtl" className="bg-white pt-4 pb-10 relative overflow-hidden">
      {/* Decorative orange spark glints at the edges — gives the
          section that "premium / award" feel without forcing a hero
          background. Kept very subtle so they read as accents not
          content. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-12 -end-12 h-64 w-64 rounded-full opacity-30"
        style={{ background: 'radial-gradient(circle, rgba(247,148,29,0.25) 0%, transparent 70%)' }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-12 -start-12 h-64 w-64 rounded-full opacity-20"
        style={{ background: 'radial-gradient(circle, rgba(247,148,29,0.20) 0%, transparent 70%)' }}
      />

      <div className="relative max-w-3xl mx-auto px-4 sm:px-6">
        {/* Header */}
        <div className="text-center mb-5">
          <p
            className="uppercase mb-1.5"
            style={{ color: '#F7941D', fontSize: 11, fontWeight: 500, letterSpacing: '0.12em' }}
          >
            למה בוחרים ב-BUILDUP?
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-5 mt-8">
          {BADGES.map((badge) => (
            <StatBadge key={badge.label} badge={badge} />
          ))}
        </div>
      </div>
    </section>
  );
}
