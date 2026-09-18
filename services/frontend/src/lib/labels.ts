// U8 §1 · shared Hebrew label maps.
//
// Enum values that come from the database (profession_code, region,
// origin_country) already have Hebrew labels served through
// EnumsContext — those stay there. This file exists for the OTHER
// category: hard-coded value sets (ad_type, tier, subscription
// status, price_unit, marketplace category, entity type) that used
// to live as one-off `const XXX_LABEL: Record<string, string> = {…}`
// maps at the top of individual page files.
//
// Local label maps are a subtle regression risk. When someone adds
// a new enum value to the backend and updates one page, the other
// pages still show the raw code. U8 §1 caught nine call-sites
// duplicating the same handful of maps. This module removes the
// duplication for the cases where every duplicate agreed on values.
//
// Screens whose labels INTENTIONALLY differ from the shared ones —
// e.g. `/billing` uses `'מנוי פעיל'` where dashboards use `'פעיל'`;
// `/marketplace/[id]` uses `'זמין'` where an admin listing might
// use `'פעיל'` — keep their own local maps by design. The U8 §1
// report documents each such conflict.
//
// Rules:
//   1. Every label falls back to the raw code when it's unknown, so
//      an unrecognised value shows something (not `undefined`).
//   2. Prefer `labelFor(map, code)` over `map[code]` at the call
//      site — it does the fallback consistently and works for
//      nullish codes.

export type AdType = 'worker' | 'housing';

export const AD_TYPE_HE: Record<string, string> = {
  worker:  'עובדים',
  housing: 'דיור',
};

// price_unit on marketplace_listings. Every value used in the UI.
export const PRICE_UNIT_HE: Record<string, string> = {
  per_month:  'לחודש',
  per_night:  'ללילה',
  fixed:      'מחיר קבוע',
  negotiable: 'למשא ומתן',
};

// Marketplace category — the FALLBACK when the admin table hasn't
// loaded. The live admin table wins when it does. Kept here so the
// same fallback is used everywhere — `/marketplace` and the corp
// "new listing" form both used to define it separately.
export const CATEGORY_HE_FALLBACK: Record<string, string> = {
  housing:   'דיור',
  equipment: 'ציוד',
  services:  'שירותים',
  other:     'אחר',
};

// Subscription tier — short form used in dashboard chips and admin
// tables. Do NOT extend without updating every caller; the landing
// page's larger TIER_HE (includes 'free', 'premium', 'trial') is a
// deliberately separate map because it renders values the shipping
// tiers don't include.
export const TIER_HE_SHORT: Record<string, string> = {
  basic:    'בסיסי',
  advanced: 'מתקדם',
  pro:      'פרו',
};

// Subscription status — SHORT form. `/billing` uses a longer form
// ('תקופת ניסיון' vs 'ניסיון', 'מנוי פעיל' vs 'פעיל') that reads
// better on the marketing-adjacent billing page; that stays local
// by design.
export const SUBSCRIPTION_STATUS_HE_SHORT: Record<string, string> = {
  trialing:  'ניסיון',
  active:    'פעיל',
  past_due:  'תשלום נכשל',
  cancelled: 'בוטל',
  expired:   'פג',
  // R9 §5 · admin-granted, never billed.
  comped:    'פעיל · ללא חיוב',
};

// Entity type. `service_provider` reserved for U7 — every existing
// UI still branches on 'contractor'/'corporation' only.
export const ENTITY_TYPE_HE: Record<string, string> = {
  contractor:       'קבלן',
  corporation:      'תאגיד',
  service_provider: 'ספק שירותים',
};

// General-purpose "look up in map, fall back to the raw code, fall
// back to a dash if the code itself is missing". Callers that only
// have string | null | undefined should reach for this over `map[code]`.
export function labelFor(
  map: Record<string, string>,
  code: string | null | undefined,
  fallback = '—',
): string {
  if (!code) return fallback;
  return map[code] ?? code;
}
