// L3 — trust signal on every search result row. Server derives the
// level (verified / registered / unverified) via a JOIN in search.py;
// this component renders the badge. Corp name NEVER appears here —
// name comes from /contact-reveal only.
//
// U6 §3 — the label now spells out which ENTITY the trust level
// belongs to. `טרם אומת` alone didn't tell users whether they were
// looking at an unverified corporation or an unverified contractor
// (or, later, an unverified service provider). Server passes the
// entity type; this component just renders the composite label.
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

// U6 §3 — 'contractor' is used on the contractor's own dashboard (not
// in search results). U7 will add 'service_provider' as a fourth value.
export type TrustEntity = 'corporation' | 'contractor' | 'service_provider';

interface TrustBadgeProps {
  level: TrustLevel;
  entity?: TrustEntity;  // defaults to 'corporation' for search-result callers
  size?: 'sm' | 'md';
  className?: string;
}

// Hebrew noun the label starts with. Kept in one place so U7 can
// add 'ספק' without editing three switch statements elsewhere.
const ENTITY_NOUN: Record<TrustEntity, string> = {
  corporation:      'תאגיד',
  contractor:       'קבלן',
  service_provider: 'ספק',
};

interface StatusShape {
  prefix:   string;  // ✓ / ⚠ / '' — carries meaning independent of colour
  status:   string;  // מאומת / רשום / טרם אומת
  aria:     (entity: string) => string;
  bg:       string;
  text:     string;
  border:   string;
  Icon:     typeof ShieldCheck;
}

const STATUS: Record<TrustLevel, StatusShape> = {
  verified: {
    prefix: '✓',
    status: 'מאומת',
    aria:   (e) => `ה${e} אומת מול מרשם ממשלתי`,
    bg:     'bg-emerald-50',
    text:   'text-emerald-800',
    border: 'border-emerald-200',
    Icon:   ShieldCheck,
  },
  registered: {
    prefix: '',
    status: 'רשום',
    aria:   (e) => `ה${e} רשום במערכת ולא אומת מול מרשם ממשלתי`,
    bg:     'bg-slate-100',
    text:   'text-slate-700',
    border: 'border-slate-300',
    Icon:   Building,
  },
  unverified: {
    prefix: '⚠',
    status: 'טרם אומת',
    aria:   (e) => `ה${e} עדיין לא אומת מול מרשם ממשלתי`,
    bg:     'bg-amber-50',
    text:   'text-amber-900',
    // Dashed border sets this badge apart from the SOLID amber-300
    // border used by PromotedBadge — one shape says "promoted", the
    // other says "not yet verified". Same colour family, different
    // visual grammar.
    border: 'border border-dashed border-amber-500',
    Icon:   AlertTriangle,
  },
};

export function TrustBadge({ level, entity = 'corporation', size = 'sm', className = '' }: TrustBadgeProps) {
  const s = STATUS[level];
  const noun = ENTITY_NOUN[entity];
  const label = s.prefix ? `${s.prefix} ${noun} ${s.status}` : `${noun} ${s.status}`;
  const aria  = s.aria(noun);
  const sizing = size === 'sm' ? 'text-[10px] font-semibold' : 'text-xs font-semibold';
  return (
    <span
      className={
        `shrink-0 inline-flex items-center gap-1 rounded-full ` +
        `${s.bg} ${s.text} ${s.border} px-2 py-0.5 ${sizing} ${className}`
      }
      title={aria}
      aria-label={aria}
    >
      <s.Icon className="w-3 h-3" aria-hidden="true" />
      {label}
    </span>
  );
}
