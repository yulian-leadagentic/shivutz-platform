// L4 — single reusable disclosure chip for boosted/paid placements.
//
// Rendered on every promoted card (landing "חם בפורטל" carousel,
// featured search cards, corp's own boosted ads on /corporation/ads,
// paid landing ad-slots when applicable). Organic cards MUST NOT
// render it — the caller is responsible for the boost/promotion
// check.
//
// Accessibility contract:
//   - The word "מקודם" is a real text node, so screen readers
//     announce it as part of the card's accessible name.
//   - The Zap icon carries aria-hidden so the visual doubles as a
//     glance-value without polluting the announcement with a second
//     token.
//   - Colour is a supporting cue, not the only channel — disclosure
//     is conveyed by TEXT.
//
// Uses DS tokens (brand-100 bg, brand-700 text, brand-500 fill on
// the icon accent) rather than ad-hoc hex, so a future palette
// swap propagates in one place.

import { Zap } from 'lucide-react';

interface PromotedBadgeProps {
  /** Optional size — 'sm' matches the landing carousel's dense
   *  overlay footprint (10px text); 'md' matches everything else. */
  size?: 'sm' | 'md';
  className?: string;
}

export function PromotedBadge({ size = 'md', className = '' }: PromotedBadgeProps) {
  const sizing = size === 'sm'
    ? 'text-[10px] font-bold'
    : 'text-xs font-semibold';
  return (
    <span
      className={
        `shrink-0 inline-flex items-center gap-1 rounded-full ` +
        `bg-brand-100 text-brand-700 px-2 py-0.5 ${sizing} ${className}`
      }
    >
      <Zap className="w-3 h-3 fill-brand-500" aria-hidden="true" />
      מקודם
    </span>
  );
}
