// Profession → Lucide React icon mapping.
//
// Wave 3 (2026-05-06): the new contractor "find workers" flow uses a
// tile grid of professions, each with an icon. We start with Lucide's
// stock icons mapped by best-fit semantics. If the visual outcome
// isn't right, we'll swap in custom SVGs later.
import type { LucideIcon } from 'lucide-react';
import {
  Building2,    // skeleton
  Construction, // scaffolding
  Frame,        // formwork
  Hammer,       // plastering
  HardHat,      // general / fallback
  LayoutGrid,   // flooring
  PaintBucket,  // painting
  PipetteIcon,  // plumbing
  Wrench,       // generic
  Zap,          // electricity
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
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

export function getProfessionIcon(code: string): LucideIcon {
  return ICONS[code] ?? Wrench;
}
