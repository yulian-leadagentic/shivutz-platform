// BuildUp brand logo — single source of truth for the wordmark.
//
// We render the transparent-bg PNG (white + orange on transparent).
// On its own it only reads well over dark surfaces — on white the
// white parts vanish — so we always wrap the lockup in a dark navy
// panel. That keeps the logo visually consistent regardless of the
// surrounding page background.
//
// The optional `bare` prop skips the navy panel for cases where the
// surrounding container is already dark (sidebars, hero, landing
// nav over the dark hero) and a wrapper would just add visual
// noise.
//
// `size` controls the rendered height in px. Width auto-scales.

import Image from 'next/image';

interface LogoProps {
  /** Height in pixels for the logo image. */
  size?: number;
  /** Skip the dark wrapper panel — use when the surrounding
   *  container is already dark and a panel would be redundant. */
  bare?: boolean;
  className?: string;
}

export default function Logo({ size = 48, bare = false, className = '' }: LogoProps) {
  // ~1.27 aspect from the lockup PNG. Width auto-derives so the asset
  // doesn't squash at any size.
  const width = Math.round(size * 1.27);
  const img = (
    <Image
      src="/brand/buildup-logo-light.png"
      alt="BuildUp"
      width={width}
      height={size}
      className="object-contain"
      style={{ height: size, width: 'auto' }}
      priority
      unoptimized
    />
  );
  if (bare) {
    return <span className={className}>{img}</span>;
  }
  // Padding scales with size so the panel always looks intentional,
  // not cramped or balloon-y. Rounded-2xl matches the rest of the
  // card / panel aesthetic.
  const pad = Math.max(8, Math.round(size * 0.18));
  return (
    <span
      className={`inline-flex items-center justify-center bg-slate-900 rounded-2xl ${className}`}
      style={{ padding: `${pad}px ${pad * 1.5}px` }}
    >
      {img}
    </span>
  );
}
