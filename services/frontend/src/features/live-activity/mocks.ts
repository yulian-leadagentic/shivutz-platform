import type { ActivityItem, AudienceRole, Mix } from './types';

// Per-role mix weights — 0 = never shown to this audience, 3 = highly
// favoured. Values are RELATIVE inside the picker.
//
// Two specialised flavours, one per surface, so the bubble and the
// in-page showcase don't echo the same headline. The split is
// conceptual:
//
//   SHOWCASE — "what the platform OFFERS":
//      breadth + opportunity. Weighted toward inventory-like items
//      (workers available, housing, services, platform pulse + the
//      success-story closed-match category). Sells "there's a lot here".
//
//   BUBBLE — "what's HAPPENING right now":
//      urgency + people doing things. Weighted toward activity-like
//      items (new requirements, active corps/contractors, fresh worker
//      drops). Sells "if you don't check, you might miss it".
//
// MIX_BY_ROLE stays as a generic default for any caller that doesn't
// specify a surface; new code should pick one of the two below.

export const MIX_BY_ROLE: Record<AudienceRole, Mix> = {
  anon: {
    workers_available: 2, requirement_new: 2, housing_new: 1, match_closed: 1,
    service_new: 1, corp_active: 1, contractor_active: 1, platform_pulse: 1,
  },
  contractor: {
    workers_available: 3, housing_new: 2, match_closed: 2, corp_active: 2,
    requirement_new: 1, service_new: 1, contractor_active: 0, platform_pulse: 1,
  },
  corporation: {
    requirement_new: 3, contractor_active: 2, housing_new: 2, match_closed: 2,
    service_new: 1, workers_available: 1, corp_active: 0, platform_pulse: 1,
  },
};

// Both showcase + bubble mixes now zero out housing_new and service_new
// — at this stage of the rollout the live surfaces should focus the
// visitor's attention on the contractor / corporation activity, not on
// ancillary inventory (housing, services). The other categories that
// remain — workers_available, requirement_new, match_closed,
// corp_active, contractor_active, platform_pulse — all describe
// activity ON the contractor / corporation side of the platform.

export const MIX_SHOWCASE_BY_ROLE: Record<AudienceRole, Mix> = {
  anon: {
    workers_available: 3, requirement_new: 3, match_closed: 2, platform_pulse: 2,
    corp_active: 1, contractor_active: 1,
    housing_new: 0, service_new: 0,
  },
  contractor: {
    workers_available: 3, corp_active: 2, match_closed: 2, platform_pulse: 2,
    requirement_new: 0, contractor_active: 0,
    housing_new: 0, service_new: 0,
  },
  corporation: {
    requirement_new: 3, contractor_active: 2, match_closed: 2, platform_pulse: 2,
    workers_available: 1,
    corp_active: 0, housing_new: 0, service_new: 0,
  },
};

export const MIX_BUBBLE_BY_ROLE: Record<AudienceRole, Mix> = {
  anon: {
    requirement_new: 3, workers_available: 2, corp_active: 2, contractor_active: 2,
    match_closed: 1, platform_pulse: 1,
    housing_new: 0, service_new: 0,
  },
  contractor: {
    workers_available: 3, corp_active: 3, requirement_new: 1,
    match_closed: 1, platform_pulse: 1,
    contractor_active: 0, housing_new: 0, service_new: 0,
  },
  corporation: {
    requirement_new: 3, contractor_active: 3, workers_available: 1,
    match_closed: 1, platform_pulse: 1,
    corp_active: 0, housing_new: 0, service_new: 0,
  },
};

// "Minutes ago" the item nominally happened. Picked from this set per
// item so the feed always shows a believable spread of recent + slightly
// older activity. Resolved to an ISO timestamp at module-load below.
const SAMPLE_MINUTES = [1, 2, 4, 7, 11, 17, 23, 34, 48, 73, 95, 142, 210];

let _idCounter = 0;
function uid(): string { return `mock-${++_idCounter}`; }

function ago(min: number): string {
  return new Date(Date.now() - min * 60_000).toISOString();
}

// Round-robin through the sample minutes so the feed shows a believable
// spread rather than every item claiming "הרגע". Re-seeds each module
// load so every page visit feels fresh.
let _minIdx = 0;
function nextOccurred(): string {
  const m = SAMPLE_MINUTES[_minIdx % SAMPLE_MINUTES.length];
  _minIdx += 1;
  return ago(m);
}

// Hand-written copy — every sentence has been audited against the
// privacy guardrails: no names, no money, no exact dates, no doc IDs.
// Counts are always ≥3 (so a single org isn't unique-identifiable),
// regions roll up to the 5 standard buckets, origins are general.
//
// When extending this list, keep each sentence under ~80 chars after
// the substitutions resolve so the row doesn't truncate awkwardly on
// mobile.
export const MOCK_ITEMS: ActivityItem[] = [
  // ── workers_available ───────────────────────────────────────────────
  { id: uid(), category: 'workers_available', cta_intent: 'check_match',
    text: 'קבוצה של 8 פועלי ריצוף מאוקראינה זמינה — אזור מרכז',
    meta: { profession_code: 'flooring', origin_code: 'UA', region_code: 'center', count: 8, opportunity_type: 'worker' },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'workers_available', cta_intent: 'check_match',
    text: '12 טייחים מתאילנד עודכנו כזמינים — אזור צפון',
    meta: { profession_code: 'plastering', origin_code: 'TH', region_code: 'north', count: 12 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'workers_available', cta_intent: 'check_match',
    text: '5 רתכים ממולדובה התפנו השבוע — אזור דרום',
    meta: { profession_code: 'scaffolding', origin_code: 'MD', region_code: 'south', count: 5 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'workers_available', cta_intent: 'check_match',
    text: '7 פועלי שלד מהודו זמינים מתחילת החודש — כל הארץ',
    meta: { profession_code: 'skeleton', origin_code: 'IN', region_code: 'national', count: 7 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'workers_available', cta_intent: 'check_match',
    text: '4 אינסטלטורים מסרי לנקה זמינים — אזור ירושלים',
    meta: { profession_code: 'plumbing', origin_code: 'LK', region_code: 'jerusalem', count: 4 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'workers_available', cta_intent: 'check_match',
    text: '9 פועלי גמרים מאוקראינה זמינים — תחילת עבודה מיידית',
    meta: { profession_code: 'painting', origin_code: 'UA', count: 9 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'workers_available', cta_intent: 'check_match',
    text: '6 פועלי תפסנות מתאילנד עודכנו כזמינים — אזור מרכז',
    meta: { profession_code: 'formwork', origin_code: 'TH', region_code: 'center', count: 6 },
    occurred_at: nextOccurred() },

  // ── requirement_new ─────────────────────────────────────────────────
  { id: uid(), category: 'requirement_new', cta_intent: 'see_requirements',
    text: 'דרישה חדשה נפתחה — 10 פועלי גמרים, אזור מרכז',
    meta: { profession_code: 'painting', region_code: 'center', count: 10, opportunity_type: 'requirement' },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'requirement_new', cta_intent: 'see_requirements',
    text: 'קבלן פרסם בקשה ל-6 רתכים, התחלה בתוך שבועיים',
    meta: { profession_code: 'scaffolding', count: 6 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'requirement_new', cta_intent: 'see_requirements',
    text: 'דרישה ל-4 פועלי ריצוף מסין נפתחה היום — אזור צפון',
    meta: { profession_code: 'flooring', origin_code: 'CN', region_code: 'north', count: 4 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'requirement_new', cta_intent: 'see_requirements',
    text: 'בקשה חדשה ל-15 פועלי שלד נפתחה — אזור דרום',
    meta: { profession_code: 'skeleton', region_code: 'south', count: 15 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'requirement_new', cta_intent: 'see_requirements',
    text: 'דרישה ל-8 פועלי תפסנות — התחלה תוך 30 יום',
    meta: { profession_code: 'formwork', count: 8 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'requirement_new', cta_intent: 'see_requirements',
    text: 'קבלן מחפש 5 אינסטלטורים — אזור ירושלים',
    meta: { profession_code: 'plumbing', region_code: 'jerusalem', count: 5 },
    occurred_at: nextOccurred() },

  // ── housing_new ─────────────────────────────────────────────────────
  { id: uid(), category: 'housing_new', cta_intent: 'see_housing',
    text: 'מתחם מגורים חדש פורסם — 24 מיטות, אזור מרכז',
    meta: { region_code: 'center', count: 24, opportunity_type: 'housing' },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'housing_new', cta_intent: 'see_housing',
    text: 'דירת עובדים ל-12 איש פורסמה — אזור צפון',
    meta: { region_code: 'north', count: 12, opportunity_type: 'housing' },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'housing_new', cta_intent: 'see_housing',
    text: 'נפתח רישום למתחם מגורים ל-30 עובדים — אזור דרום',
    meta: { region_code: 'south', count: 30, opportunity_type: 'housing' },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'housing_new', cta_intent: 'see_housing',
    text: 'מתחם חדש לעובדים זרים נפתח — אזור ירושלים',
    meta: { region_code: 'jerusalem', opportunity_type: 'housing' },
    occurred_at: nextOccurred() },

  // ── match_closed ────────────────────────────────────────────────────
  { id: uid(), category: 'match_closed', cta_intent: 'post_requirement',
    text: 'עסקה נסגרה היום — 8 פועלי ריצוף, אזור מרכז',
    meta: { profession_code: 'flooring', region_code: 'center', count: 8, opportunity_type: 'match' },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'match_closed', cta_intent: 'post_requirement',
    text: '12 פועלי שלד שובצו לקבלן השבוע — אזור צפון',
    meta: { profession_code: 'skeleton', region_code: 'north', count: 12 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'match_closed', cta_intent: 'post_requirement',
    text: 'עסקה נחתמה — 5 רתכים, אזור דרום',
    meta: { profession_code: 'scaffolding', region_code: 'south', count: 5 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'match_closed', cta_intent: 'post_requirement',
    text: 'עסקה נסגרה — 7 טייחים, אזור ירושלים',
    meta: { profession_code: 'plastering', region_code: 'jerusalem', count: 7 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'match_closed', cta_intent: 'post_requirement',
    text: 'עסקה נסגרה — 10 פועלי גמרים, אזור מרכז',
    meta: { profession_code: 'painting', region_code: 'center', count: 10 },
    occurred_at: nextOccurred() },

  // ── service_new ─────────────────────────────────────────────────────
  { id: uid(), category: 'service_new', cta_intent: 'see_services',
    text: 'ספק הסעות חדש הצטרף לפלטפורמה — אזור מרכז',
    meta: { region_code: 'center', opportunity_type: 'service' },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'service_new', cta_intent: 'see_services',
    text: 'ספק חדש לטיפול בוויזות הצטרף לפלטפורמה',
    meta: { opportunity_type: 'service' },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'service_new', cta_intent: 'see_services',
    text: 'ספק חדש לניהול עובדים זרים הצטרף לפלטפורמה — כל הארץ',
    meta: { region_code: 'national', opportunity_type: 'service' },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'service_new', cta_intent: 'see_services',
    text: 'ספק חדש לביטוח עובדים זרים הצטרף לפלטפורמה',
    meta: { opportunity_type: 'service' },
    occurred_at: nextOccurred() },

  // ── corp_active ─────────────────────────────────────────────────────
  { id: uid(), category: 'corp_active', cta_intent: 'post_availability',
    text: 'תאגיד פעיל פרסם זמינות לרתכים השבוע',
    meta: { profession_code: 'scaffolding' },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'corp_active', cta_intent: 'post_availability',
    text: 'תאגיד עדכן 20 עובדים חדשים בתחום הריצוף',
    meta: { profession_code: 'flooring', count: 20 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'corp_active', cta_intent: 'post_availability',
    text: 'תאגיד פעיל פתח רישום לקבוצת טייחים מהודו',
    meta: { profession_code: 'plastering', origin_code: 'IN' },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'corp_active', cta_intent: 'post_availability',
    text: 'תאגיד פתח רישום ל-15 עובדים חדשים השבוע',
    meta: { count: 15 },
    occurred_at: nextOccurred() },

  // ── contractor_active ───────────────────────────────────────────────
  { id: uid(), category: 'contractor_active', cta_intent: 'see_requirements',
    text: 'קבלן פעיל בודק התאמות באזור המרכז',
    meta: { region_code: 'center' },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'contractor_active', cta_intent: 'see_requirements',
    text: 'קבלנים בדקו 45 התאמות בשעה האחרונה',
    meta: { count: 45 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'contractor_active', cta_intent: 'see_requirements',
    text: 'קבלן פעיל פתח 3 בקשות חדשות השבוע',
    meta: { count: 3 },
    occurred_at: nextOccurred() },

  // ── platform_pulse ──────────────────────────────────────────────────
  { id: uid(), category: 'platform_pulse', cta_intent: 'see_requirements',
    text: '12 בקשות חדשות נפתחו ב-24 השעות האחרונות',
    meta: { count: 12 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'platform_pulse', cta_intent: 'check_match',
    text: '47 עובדים חדשים נוספו לפלטפורמה השבוע',
    meta: { count: 47 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'platform_pulse', cta_intent: 'see_requirements',
    text: 'מספר ההצעות הפעילות בפלטפורמה עלה ב-15% השבוע',
    occurred_at: nextOccurred() },
  { id: uid(), category: 'platform_pulse', cta_intent: 'check_match',
    text: 'מעל 200 עובדים זמינים כרגע בפלטפורמה',
    meta: { count: 200 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'platform_pulse', cta_intent: 'see_requirements',
    text: 'מעל 30 התאמות פתוחות בפלטפורמה כרגע',
    meta: { count: 30 },
    occurred_at: nextOccurred() },
];
