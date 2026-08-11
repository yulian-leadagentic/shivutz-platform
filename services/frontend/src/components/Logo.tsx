// TagidAI brand logo — single source of truth for the wordmark
// and the icon-only mark.
//
// Two axes:
//
//   variant="on-light" / "on-dark"
//     on-light  → navy + orange on transparent (for white cards,
//                 scrolled nav, dashboards, auth surfaces).
//     on-dark   → white + orange on transparent (for slate-900
//                 sidebars, dark hero bands, dark modals). Without
//                 this the navy hides on dark surfaces.
//
//   kind="lockup" / "icon"
//     lockup    → globe + workers + "TagidAI" wordmark. The full
//                 brand mark; use where there's horizontal room
//                 (hero, auth cards, footer, header-md+).
//     icon      → globe + workers only (square, no wordmark). Use
//                 where space is tight (top-bar corner, avatar-
//                 sized chips, tab titles).
//
// Size buckets keep visual weight consistent across the app:
//   xs  → 24px tall — tab-bar / avatar-adjacent chips
//   sm  → 32px tall — sidebars, topbars, footer
//   md  → 44px tall — landing nav, in-page section headers
//   lg  → 56px tall — auth, onboarding, the "brand moment" screens

import Image from 'next/image';

export type LogoVariant = 'on-light' | 'on-dark';
export type LogoKind    = 'lockup' | 'icon';
export type LogoSize    = 'xs' | 'sm' | 'md' | 'lg';

const HEIGHT: Record<LogoSize, number> = { xs: 24, sm: 32, md: 44, lg: 56 };

// Aspect ratios ≈ (source width / source height) of each generated
// asset. Keep in sync with generate-tagidai.py's crop dimensions.
// Measured from the actual crop output — lockup 954×894 = 1.067,
// icon 740×616 = 1.201.
const ASPECT: Record<LogoKind, number> = { lockup: 1.067, icon: 1.201 };

interface LogoProps {
  /** Visual weight bucket. Defaults to 'md'. */
  size?: LogoSize;
  /** Which tone to render. Defaults to 'on-light'. */
  variant?: LogoVariant;
  /** Full lockup (with wordmark) or icon-only. Defaults to 'lockup'. */
  kind?: LogoKind;
  className?: string;
  /** Decorative-only — pass true when the logo sits next to a
   *  visible "TagidAI" label and a second aria-label would be
   *  redundant noise for screen readers. */
  decorative?: boolean;
}

export default function Logo({
  size      = 'md',
  variant   = 'on-light',
  kind      = 'lockup',
  className = '',
  decorative = false,
}: LogoProps) {
  const h = HEIGHT[size];
  const w = Math.round(h * ASPECT[kind]);
  const base = kind === 'icon' ? 'tagidai_icon' : 'tagidai_lockup';
  const src  = variant === 'on-dark' ? `/brand/${base}_white.png` : `/brand/${base}.png`;
  return (
    <Image
      src={src}
      alt={decorative ? '' : 'TagidAI'}
      aria-hidden={decorative || undefined}
      width={w}
      height={h}
      className={`object-contain ${className}`}
      style={{ height: h, width: 'auto' }}
      priority
      // The on-dark variant is a transparent PNG. Next.js's
      // sharp-based optimizer flattens alpha to an opaque white
      // background when it transcodes to its colormap-PNG output
      // (visibly: a white chip behind the logo on dark surfaces).
      // Skip optimization entirely so the source PNG ships as-is
      // and the alpha channel survives. The source files are
      // already small enough that bypassing the optimizer is
      // fine — switch to SVG when ready and we can drop this.
      unoptimized
    />
  );
}
