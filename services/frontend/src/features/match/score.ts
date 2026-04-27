import { MATCH_QUALITY_HIGH_PCT, MATCH_QUALITY_MEDIUM_PCT, MATCH_QUALITY_LABEL, matchQuality } from '@/i18n/he';

export const MAX_SCORE = 110;

export const CRITERIA_META: Record<string, { label: string; max: number }> = {
  profession:         { label: 'מקצוע',        max: 30 },
  region:             { label: 'אזור',          max: 20 },
  experience:         { label: 'ניסיון',        max: 20 },
  experience_partial: { label: 'ניסיון חלקי',   max: 12 },
  origin:             { label: 'ארץ מוצא',      max: 15 },
  languages:          { label: 'שפות',          max: 10 },
  languages_partial:  { label: 'שפות חלקיות',   max: 5  },
  visa:               { label: 'ויזה',          max: 15 },
  visa_tight:         { label: 'ויזה (גבולי)',  max: 8  },
};

export const MISSING_META: Record<string, string> = {
  region: 'אזור', experience: 'ניסיון', origin: 'ארץ מוצא',
  languages: 'שפות', visa: 'ויזה',
};

export function formatDate(s?: string) {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString('he-IL'); } catch { return s; }
}

export function normalizeScore(raw: number) {
  return Math.min(1, Math.max(0, raw / MAX_SCORE));
}

export function scorePct(raw: number) {
  return Math.round(normalizeScore(raw) * 100);
}

export function scoreColor(pct: number) {
  if (pct >= MATCH_QUALITY_HIGH_PCT) return 'success' as const;
  if (pct >= MATCH_QUALITY_MEDIUM_PCT) return 'warning' as const;
  return 'secondary' as const;
}

/** Human-readable quality label */
export function qualityLabel(pct: number) {
  return MATCH_QUALITY_LABEL[matchQuality(pct)];
}

export function expMonthsLabel(months: number): string | null {
  if (!months || months <= 0) return null;
  if (months < 12) return `${months} חודשים`;
  const years = Math.floor(months / 12);
  const rem   = months % 12;
  return rem > 0 ? `${years} שנה ו-${rem} חודשים` : `${years}+ שנים`;
}
