// Hebrew UI dictionaries and helpers for reuse across pages.
// Only centralizes content that is (or was) duplicated in two or more files.
// Page-specific copy that intentionally differs by context stays local.

// ─── Deal status ─────────────────────────────────────────────────────────────

export type DealStatus =
  | 'proposed'
  | 'counter_proposed'
  | 'accepted'
  | 'active'
  | 'reporting'
  | 'completed'
  | 'disputed'
  | 'cancelled';

// Superset — each surface picks the subset it shows. Contractor-side
// (re)design uses awaiting_approval / proposed / completed / cancelled;
// corp-side keeps proposed / active / completed.
export type DealFilter =
  | 'all'
  | 'awaiting_approval' // contractor-side: corp committed, contractor must act
  | 'proposed'          // sent to corp, awaiting first response
  | 'active'            // corp-side: workers in field
  | 'completed'         // closed / done
  | 'cancelled';        // cancelled / rejected / expired

export const DEAL_FILTER_LABEL: Partial<Record<DealFilter, string>> = {
  all:               'הכל',
  awaiting_approval: 'ממתינות לאישורך',
  proposed:          'ממתינות לתאגיד',
  completed:         'נסגרו',
  cancelled:         'בוטל',
};

// Status → which filter bucket it belongs to (reverse index of the groups).
// Note: status strings here are read as plain strings — the DealStatus
// union doesn't enumerate every value the API can return (the DB adds
// corp_committed, closed, cancelled_by_corp, cancelled_by_contractor,
// expired, rejected — none of which are part of the legacy union).
export const DEAL_STATUS_GROUP: Record<Exclude<DealFilter, 'all'>, string[]> = {
  awaiting_approval: ['corp_committed'],
  proposed:          ['proposed', 'counter_proposed'],
  active:            ['accepted', 'active', 'reporting'],
  completed:         ['completed', 'closed'],
  cancelled:         ['cancelled', 'cancelled_by_corp', 'cancelled_by_contractor', 'rejected', 'expired', 'disputed'],
};

export function dealMatchesFilter(status: DealStatus | string, filter: DealFilter): boolean {
  if (filter === 'all') return true;
  return (DEAL_STATUS_GROUP[filter] as string[]).includes(status);
}

// ─── Experience ranges ───────────────────────────────────────────────────────

export type ExperienceRange = '0-6' | '6-12' | '12-24' | '24-36' | '36+';

export const EXPERIENCE_RANGES: readonly { code: ExperienceRange; label: string }[] = [
  { code: '0-6',   label: '0–6 חודשים' },
  { code: '6-12',  label: '6–12 חודשים' },
  { code: '12-24', label: '12–24 חודשים' },
  { code: '24-36', label: '24–36 חודשים' },
  { code: '36+',   label: '36+ חודשים' },
] as const;

// Label/number maps are typed as `Record<string, ...>` so callers can index with
// raw API strings; the `ExperienceRange` union is exported separately for
// call sites that want strict typing.
// R2#6 — Product simplified the experience picker to a binary
// "ללא ניסיון" / "עם ניסיון". The 5-bucket scale (0-6/6-12/12-24/
// 24-36/36+ months) is kept in the keys for backward compatibility
// with existing data + the matcher's `min_experience` floor, but
// they all collapse to one of two labels here:
//   '0-6'  → ללא ניסיון   (any of the "0-something" buckets)
//   '6+'   → עם ניסיון   (anything past the 6-month floor)
// Old keys map onto the new labels so legacy worker rows render
// without producing "—".
export const EXPERIENCE_LABEL: Record<string, string> = {
  '0-6':   'ללא ניסיון',
  '6-12':  'עם ניסיון',
  '12-24': 'עם ניסיון',
  '24-36': 'עם ניסיון',
  '36+':   'עם ניסיון',
};

export const EXPERIENCE_LABEL_SHORT: Record<string, string> = {
  '0-6':   'ללא',
  '6-12':  'עם',
  '12-24': 'עם',
  '24-36': 'עם',
  '36+':   'עם',
};

export const EXPERIENCE_LOWER_MONTHS: Record<string, number> = {
  '0-6':   0,
  '6-12':  6,
  '12-24': 12,
  '24-36': 24,
  '36+':   36,
};

// Rough midpoint in months — used when a sortable/comparable number is needed.
export const EXPERIENCE_MIDPOINT_MONTHS: Record<string, number> = {
  '0-6':   3,
  '6-12':  9,
  '12-24': 18,
  '24-36': 30,
  '36+':   42,
};

// ─── Origin / country codes (ISO 3166-1 alpha-2 → Hebrew name) ──────────────

export const ORIGIN_LABEL: Record<string, string> = {
  TH: 'תאילנד',
  CN: 'סין',
  IN: 'הודו',
  PH: 'פיליפינים',
  MD: 'מולדובה',
  UA: 'אוקראינה',
  RO: 'רומניה',
  BG: 'בולגריה',
  GE: 'גאורגיה',
  MX: 'מקסיקו',
  VN: 'וייטנאם',
  NP: 'נפאל',
  SL: 'סרי לנקה', // legacy alias for LK
  LK: 'סרי לנקה',
  ID: 'אינדונזיה',
  ET: 'אתיופיה',
  ER: 'אריתריאה',
  IL: 'ישראל',
};

export function heOrigin(code?: string | null): string {
  if (!code) return '—';
  return ORIGIN_LABEL[code.toUpperCase()] ?? code;
}

// Primary language of each origin country (for auto-fill hints).
export const ORIGIN_PRIMARY_LANGUAGE: Record<string, string> = {
  RO: 'ro',
  UA: 'uk',
  MD: 'ro',
  LK: 'si',
  IN: 'hi',
  PH: 'tl',
  TH: 'th',
  CN: 'zh',
  VN: 'vi',
  NP: 'ne',
};

// ─── Languages (ISO 639-1 → Hebrew name) ────────────────────────────────────

export const LANGUAGE_LABEL: Record<string, string> = {
  he: 'עברית',
  ar: 'ערבית',
  en: 'אנגלית',
  ru: 'רוסית',
  ro: 'רומנית',
  th: 'תאילנדית',
  zh: 'סינית',
  uk: 'אוקראינית',
  bg: 'בולגרית',
  tl: 'פיליפינית',
  hi: 'הינדית',
  vi: 'וייטנאמית',
  ne: 'נפאלית',
  si: 'סינהלית',
};

export function heLang(code?: string | null): string {
  if (!code) return '';
  return LANGUAGE_LABEL[code.toLowerCase()] ?? code;
}

// Ordered list for dropdowns (he first, then the common ones for this market).
export const LANGUAGE_OPTIONS: readonly { code: string; name: string }[] = [
  { code: 'he', name: LANGUAGE_LABEL.he },
  { code: 'en', name: LANGUAGE_LABEL.en },
  { code: 'ro', name: LANGUAGE_LABEL.ro },
  { code: 'uk', name: LANGUAGE_LABEL.uk },
  { code: 'ru', name: LANGUAGE_LABEL.ru },
  { code: 'th', name: LANGUAGE_LABEL.th },
  { code: 'zh', name: LANGUAGE_LABEL.zh },
  { code: 'tl', name: LANGUAGE_LABEL.tl },
  { code: 'hi', name: LANGUAGE_LABEL.hi },
  { code: 'ar', name: LANGUAGE_LABEL.ar },
  { code: 'vi', name: LANGUAGE_LABEL.vi },
  { code: 'ne', name: LANGUAGE_LABEL.ne },
  { code: 'si', name: LANGUAGE_LABEL.si },
] as const;

// ─── Language proficiency levels ────────────────────────────────────────────

export type LanguageLevel = 'basic' | 'conversational' | 'fluent';

export const LANGUAGE_LEVELS: readonly { code: LanguageLevel; name: string }[] = [
  { code: 'basic',          name: 'בסיסי' },
  { code: 'conversational', name: 'שיחות' },
  { code: 'fluent',         name: 'שוטף' },
] as const;

// ─── Match quality thresholds ────────────────────────────────────────────────

export type MatchQuality = 'high' | 'medium' | 'low';

export const MATCH_QUALITY_HIGH_PCT = 73;
export const MATCH_QUALITY_MEDIUM_PCT = 45;

export const MATCH_QUALITY_LABEL: Record<MatchQuality, string> = {
  high:   'התאמה גבוהה',
  medium: 'התאמה בינונית',
  low:    'התאמה נמוכה',
};

export function matchQuality(pct: number): MatchQuality {
  if (pct >= MATCH_QUALITY_HIGH_PCT) return 'high';
  if (pct >= MATCH_QUALITY_MEDIUM_PCT) return 'medium';
  return 'low';
}
