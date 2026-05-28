// Profession icon component.
//
// Renders a 3D illustrated PNG from /profession-icons/{code}.png if the
// profession has one, else falls back to a Lucide stock glyph.
//
// Wave 3 (2026-05-06): the user supplied a 4x3 grid of construction
// icons (cropped per profession into public/profession-icons/). The
// Lucide fallback covers any future profession that doesn't have a
// custom image yet.
import Image from 'next/image';
import {
  Building2, Construction, Frame, Hammer, HardHat,
  LayoutGrid, PaintBucket, PipetteIcon, Wrench, Zap,
  type LucideIcon,
} from 'lucide-react';

// Codes that have a real PNG in public/profession-icons/.
const HAS_IMAGE: Record<string, boolean> = {
  flooring:    true,
  plastering:  true,
  scaffolding: true,
  formwork:    true,
  skeleton:    true,
  painting:    true,
  electricity: true,
  plumbing:    true,
  general:     true,
};

const LUCIDE_FALLBACK: Record<string, LucideIcon> = {
  flooring:    LayoutGrid,
  plastering:  Hammer,
  scaffolding: Construction,
  formwork:    Frame,
  skeleton:    Building2,
  painting:    PaintBucket,
  electricity: Zap,
  plumbing:    PipetteIcon,
  general:     HardHat,
};

interface Props {
  /** Profession code (e.g. "flooring", "plastering"). */
  code: string;
  /** Tile size in px — controls both image dimensions and Lucide stroke. */
  size?: number;
  /** Optional class for the wrapping element. */
  className?: string;
  /** Alt text for accessibility (defaults to the code). */
  alt?: string;
}

export function ProfessionIcon({ code, size = 48, className, alt }: Props) {
  if (HAS_IMAGE[code]) {
    // The illustrated PNGs aren't square (the LEGO-style renders are
    // portrait). Constrain to a `size`×`size` box but use object-contain
    // so they letterbox instead of squashing. `object-contain` is
    // forced on regardless of the caller's className.
    return (
      <Image
        src={`/profession-icons/${code}.png`}
        alt={alt ?? code}
        width={size}
        height={size}
        className={`object-contain ${className ?? ''}`}
        style={{ width: size, height: size }}
        unoptimized
      />
    );
  }
  const Lucide = LUCIDE_FALLBACK[code] ?? Wrench;
  return <Lucide className={className} style={{ width: size, height: size }} />;
}
