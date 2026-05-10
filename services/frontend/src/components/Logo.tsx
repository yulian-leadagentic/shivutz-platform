// BuildUp brand logo — single source of truth for the wordmark.
//
// Two variants:
//   - "image" (default): full PNG logo (globe + 3 hard-hat workers + the
//     "BuildUp" wordmark). Use for landing/login/register cards and any
//     surface where the full lockup fits.
//   - "wordmark": text-only "BuildUp" — for tight spaces (sidebars,
//     compact nav rows) where the full image lockup is too dense.
//
// `size` controls the rendered height in px. Width auto-scales for
// the image variant; text size scales for the wordmark variant.

import Image from 'next/image';

interface LogoProps {
  variant?: 'image' | 'wordmark';
  /** Height in pixels for the image variant; pseudo-height for wordmark. */
  size?: number;
  className?: string;
  /** Override of the dark-on-light wordmark color. Ignored for image variant. */
  wordmarkClassName?: string;
}

export default function Logo({
  variant = 'image',
  size = 40,
  className = '',
  wordmarkClassName = 'text-brand-600',
}: LogoProps) {
  if (variant === 'wordmark') {
    // Pure-text fallback. Sized roughly proportional to the image
    // height the caller asked for so swapping variants doesn't shift
    // the surrounding layout.
    const fontPx = Math.round(size * 0.62);
    return (
      <span
        dir="ltr"
        className={`font-black tracking-tight ${wordmarkClassName} ${className}`}
        style={{ fontSize: `${fontPx}px`, lineHeight: 1 }}
      >
        BuildUp
      </span>
    );
  }
  // Image variant — keep the original aspect ratio (~1.27:1, the PNG
  // is wider than tall). next/image needs explicit width+height; we
  // derive width from height using that ratio so the asset doesn't
  // get smushed at any size.
  const width = Math.round(size * 1.27);
  return (
    <Image
      src="/brand/buildup-logo.png"
      alt="BuildUp"
      width={width}
      height={size}
      className={className}
      priority
      unoptimized
    />
  );
}
