// L3 — trust signal on every search result row. Server derives the
// level (verified / registered / unverified) via a JOIN in search.py;
// this component renders the badge. Corp name NEVER appears here —
// name comes from /contact-reveal only.
//
// Design constraints (per cc_prompt_L3_trust_signal.md §3):
//   - "אל תשתמש בענבר של `boosted`" — must not clash with the amber
//     already used by PromotedBadge (border-amber-300 / bg-amber-50).
//     Unverified uses a DASHED border + darker amber-800 text to
//     read as "temporary, needs attention" rather than "promoted".
//   - Not colour-alone — every badge carries a text label + an icon
//     with aria-hidden. Screen readers get the level via aria-label.
//   - Contrast ≥ 4.5:1 on every badge (verified: emerald-800 on
//     emerald-50 ≈ 8:1; registered: slate-700 on slate-100 ≈ 9:1;
//     unverified: amber-900 on amber-50 ≈ 8:1).
//   - Copy is non-accusatory — "טרם אומת" (not yet verified) rather
//     than "לא מאומת" or "לא אמין".

import { ShieldCheck, AlertTriangle, Building } from 'lucide-react';
import type { TrustLevel } from '@/lib/api/search';

interface TrustBadgeProps {
  level: TrustLevel;
  size?: 'sm' | 'md';
  className?: string;
}

const VARIANTS: Record<TrustLevel, {
  label:      string;
  ariaLabel:  string;
  bg:         string;
  text:       string;
  border:     string;
  Icon:       typeof ShieldCheck;
}> = {
  verified: {
    label:     '✓ תאגיד מאומת',
    ariaLabel: 'אומת מול מרשם קבלני כוח האדם של משרד הפנים',
    bg:        'bg-emerald-50',
    text:      'text-emerald-800',
    border:    'border-emerald-200',
    Icon:      ShieldCheck,
  },
  registered: {
    label:     'רשום במערכת',
    ariaLabel: 'התאגיד רשום ולא אומת מול מרשם ממשלתי',
    bg:        'bg-slate-100',
    text:      'text-slate-700',
    border:    'border-slate-300',
    Icon:      Building,
  },
  unverified: {
    label:     '⚠ טרם אומת',
    ariaLabel: 'התאגיד עדיין לא הועלה למרשם ממשלתי',
    bg:        'bg-amber-50',
    text:      'text-amber-900',
    // Dashed border sets this badge apart from the SOLID amber-300
    // border used by PromotedBadge — one shape says "promoted", the
    // other says "not yet verified". Same colour family, different
    // visual grammar.
    border:    'border border-dashed border-amber-500',
    Icon:      AlertTriangle,
  },
};

export function TrustBadge({ level, size = 'sm', className = '' }: TrustBadgeProps) {
  const v = VARIANTS[level];
  const sizing = size === 'sm' ? 'text-[10px] font-semibold' : 'text-xs font-semibold';
  return (
    <span
      className={
        `shrink-0 inline-flex items-center gap-1 rounded-full ` +
        `${v.bg} ${v.text} ${v.border} px-2 py-0.5 ${sizing} ${className}`
      }
      title={v.ariaLabel}
      aria-label={v.ariaLabel}
    >
      <v.Icon className="w-3 h-3" aria-hidden="true" />
      {v.label}
    </span>
  );
}
