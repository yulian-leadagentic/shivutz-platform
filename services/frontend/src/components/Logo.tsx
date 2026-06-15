// BuildUp brand logo — single source of truth for the wordmark.
//
// Two variants ship with the app and the caller picks the one that
// matches the surrounding surface:
//
//   variant="on-light"  → /brand/buildup-logo.png
//                         Navy + orange lockup with the lockup's own
//                         white space. Use on white cards, scrolled
//                         nav, dashboards, auth/onboarding.
//   variant="on-dark"   → /brand/buildup-logo-light.png
//                         White + orange wordmark on transparent.
//                         Use on slate-900 sidebars, the unscrolled
//                         landing hero, dark modals.
//
// The previous "wrap in a navy chip" workaround is gone: pick the
// right variant for the surface and the lockup composes naturally
// without an outer container.
//
// Size buckets keep visual weight consistent across the app:
//   sm  → 32px tall — sidebars, topbars, footer
//   md  → 44px tall — landing nav, in-page section headers
//   lg  → 56px tall — auth, onboarding, the "brand moment" screens

import Image from 'next/image';

export type LogoVariant = 'on-light' | 'on-dark';
export type LogoSize = 'sm' | 'md' | 'lg';

const HEIGHT: Record<LogoSize, number> = { sm: 32, md: 44, lg: 56 };

interface LogoProps {
  /** Visual weight bucket. Defaults to 'md'. */
  size?: LogoSize;
  /** Which lockup to render. Defaults to 'on-light' since most of
   *  the authenticated app surfaces are white cards. */
  variant?: LogoVariant;
  className?: string;
  /** Decorative-only — pass true when the logo sits next to a
   *  visible "BuildUp" label and a second aria-label would be
   *  redundant noise for screen readers. */
  decorative?: boolean;
}

export default function Logo({
  size      = 'md',
  variant   = 'on-light',
  className = '',
  decorative = false,
}: LogoProps) {
  const h = HEIGHT[size];
  // Both source files share the ~1.27 lockup aspect ratio.
  const w = Math.round(h * 1.27);
  const src = variant === 'on-dark'
    ? '/brand/buildup-logo-light.png'
    : '/brand/buildup-logo.png';
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
