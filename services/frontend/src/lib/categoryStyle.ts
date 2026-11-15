// R37 Part 3 · how a marketplace category looks: its icon, the colour
// of the bar on a card with no photo, and its chip.
//
// Three files each kept their own copy of this for four codes (the
// listing card, the detail panel, the marketplace page). The category
// list is now ours (R34 item 12): insurance, transport, housing,
// equipment, scaffolding, courses. `services` and `other` stay here for
// the rows that still carry them.
//
// The chip text is the 800 shade on the 100 tint: the 700 shade the
// old copies used does not reach 4.5:1 on its own tint at this size.

import {
  Briefcase, Bus, Construction, GraduationCap, Home, MoreHorizontal, ShieldCheck, Tag, Wrench,
  type LucideIcon,
} from 'lucide-react';

export interface CategoryStyle {
  icon: LucideIcon;
  bar:  string;
  chip: string;
}

const STYLES: Record<string, CategoryStyle> = {
  insurance:   { icon: ShieldCheck,    bar: 'bg-sky-500',     chip: 'bg-sky-100 text-sky-800' },
  transport:   { icon: Bus,            bar: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-800' },
  housing:     { icon: Home,           bar: 'bg-brand-500',   chip: 'bg-brand-100 text-brand-800' },
  equipment:   { icon: Wrench,         bar: 'bg-amber-500',   chip: 'bg-amber-100 text-amber-800' },
  scaffolding: { icon: Construction,   bar: 'bg-teal-500',    chip: 'bg-teal-100 text-teal-800' },
  courses:     { icon: GraduationCap,  bar: 'bg-violet-500',  chip: 'bg-violet-100 text-violet-800' },
  services:    { icon: Briefcase,      bar: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-800' },
  other:       { icon: MoreHorizontal, bar: 'bg-slate-400',   chip: 'bg-slate-100 text-slate-700' },
};

// A code an admin added later still gets a sensible look.
const UNKNOWN: CategoryStyle = { icon: Tag, bar: 'bg-slate-400', chip: 'bg-slate-100 text-slate-700' };

export function categoryStyle(code: string | null | undefined): CategoryStyle {
  return (code && STYLES[code]) || UNKNOWN;
}
