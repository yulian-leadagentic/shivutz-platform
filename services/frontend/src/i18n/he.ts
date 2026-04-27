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

export type DealFilter = 'all' | 'proposed' | 'active' | 'completed';

export const DEAL_FILTER_LABEL: Record<DealFilter, string> = {
  all: 'הכל',
  proposed: 'ממתינות לתאגיד',
  active: 'פעילות',
  completed: 'הסתיימו',
};

// Status → which filter bucket it belongs to (reverse index of the groups).
export const DEAL_STATUS_GROUP: Record<Exclude<DealFilter, 'all'>, DealStatus[]> = {
  proposed:  ['proposed', 'counter_proposed'],
  active:    ['accepted', 'active', 'reporting'],
  completed: ['completed', 'cancelled', 'disputed'],
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
export const EXPERIENCE_LABEL: Record<string, string> = {
  '0-6':   '0–6 חודשים',
  '6-12':  '6–12 חודשים',
  '12-24': '12–24 חודשים',
  '24-36': '24–36 חודשים',
  '36+':   '36+ חודשים',
};

export const EXPERIENCE_LABEL_SHORT: Record<string, string> = {
  '0-6':   '0–6 ח׳',
  '6-12':  '6–12 ח׳',
  '12-24': '12–24 ח׳',
  '24-36': '24–36 ח׳',
  '36+':   '36+ ח׳',
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
