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
// Step-3 option ב׳: every sentence is present-tense / general —
// "what the platform DOES", never "what JUST happened to a specific
// party". No dates, no exact business events. Until GET
// /api/marketplace/activity-feed exists, this content backs a demo
// surface, not a live activity claim.
//
// When extending this list, keep each sentence under ~80 chars after
// the substitutions resolve so the row doesn't truncate awkwardly on
// mobile.
export const MOCK_ITEMS: ActivityItem[] = [
  // ── workers_available ───────────────────────────────────────────────
  { id: uid(), category: 'workers_available', cta_intent: 'check_match',
    text: '8 פועלי ריצוף מאוקראינה זמינים בפורטל — אזור מרכז',
    meta: { profession_code: 'flooring', origin_code: 'UA', region_code: 'center', count: 8, opportunity_type: 'worker' },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'workers_available', cta_intent: 'check_match',
    text: '12 טייחים מתאילנד זמינים בפורטל — אזור צפון',
    meta: { profession_code: 'plastering', origin_code: 'TH', region_code: 'north', count: 12 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'workers_available', cta_intent: 'check_match',
    text: '5 רתכים ממולדובה זמינים בפורטל — אזור דרום',
    meta: { profession_code: 'scaffolding', origin_code: 'MD', region_code: 'south', count: 5 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'workers_available', cta_intent: 'check_match',
    text: '7 פועלי שלד מהודו זמינים בפורטל — כל הארץ',
    meta: { profession_code: 'skeleton', origin_code: 'IN', region_code: 'national', count: 7 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'workers_available', cta_intent: 'check_match',
    text: '4 אינסטלטורים מסרי לנקה זמינים — אזור ירושלים',
    meta: { profession_code: 'plumbing', origin_code: 'LK', region_code: 'jerusalem', count: 4 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'workers_available', cta_intent: 'check_match',
    text: '9 פועלי גמרים מאוקראינה זמינים לתחילת עבודה מיידית',
    meta: { profession_code: 'painting', origin_code: 'UA', count: 9 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'workers_available', cta_intent: 'check_match',
    text: '6 פועלי תפסנות מתאילנד זמינים בפורטל — אזור מרכז',
    meta: { profession_code: 'formwork', origin_code: 'TH', region_code: 'center', count: 6 },
    occurred_at: nextOccurred() },

  // ── requirement_new ─────────────────────────────────────────────────
  { id: uid(), category: 'requirement_new', cta_intent: 'see_requirements',
    text: 'קבלנים מבקשים 10 פועלי גמרים באזור המרכז',
    meta: { profession_code: 'painting', region_code: 'center', count: 10, opportunity_type: 'requirement' },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'requirement_new', cta_intent: 'see_requirements',
    text: 'קבלנים מפרסמים בקשות לרתכים בפורטל',
    meta: { profession_code: 'scaffolding', count: 6 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'requirement_new', cta_intent: 'see_requirements',
    text: 'בקשות לפועלי ריצוף מסין נפתחות בפורטל — אזור צפון',
    meta: { profession_code: 'flooring', origin_code: 'CN', region_code: 'north', count: 4 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'requirement_new', cta_intent: 'see_requirements',
    text: 'קבלנים מחפשים פועלי שלד בפורטל — אזור דרום',
    meta: { profession_code: 'skeleton', region_code: 'south', count: 15 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'requirement_new', cta_intent: 'see_requirements',
    text: 'קבלנים מחפשים פועלי תפסנות בפורטל',
    meta: { profession_code: 'formwork', count: 8 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'requirement_new', cta_intent: 'see_requirements',
    text: 'קבלנים מחפשים אינסטלטורים בפורטל — אזור ירושלים',
    meta: { profession_code: 'plumbing', region_code: 'jerusalem', count: 5 },
    occurred_at: nextOccurred() },

  // ── housing_new ─────────────────────────────────────────────────────
  // Category is currently zeroed out in every mix (bubble + showcase);
  // rows kept for when housing surfaces re-open — copy is present-tense
  // so it can go live without another audit.
  { id: uid(), category: 'housing_new', cta_intent: 'see_housing',
    text: 'מתחמי מגורים ל-24 עובדים זמינים בפורטל — אזור מרכז',
    meta: { region_code: 'center', count: 24, opportunity_type: 'housing' },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'housing_new', cta_intent: 'see_housing',
    text: 'דירות עובדים עד 12 מיטות זמינות בפורטל — אזור צפון',
    meta: { region_code: 'north', count: 12, opportunity_type: 'housing' },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'housing_new', cta_intent: 'see_housing',
    text: 'מתחמי מגורים עד 30 מיטות זמינים בפורטל — אזור דרום',
    meta: { region_code: 'south', count: 30, opportunity_type: 'housing' },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'housing_new', cta_intent: 'see_housing',
    text: 'מתחמי מגורים לעובדים זרים זמינים בפורטל — אזור ירושלים',
    meta: { region_code: 'jerusalem', opportunity_type: 'housing' },
    occurred_at: nextOccurred() },

  // ── match_closed ────────────────────────────────────────────────────
  { id: uid(), category: 'match_closed', cta_intent: 'post_requirement',
    text: 'עסקאות נסגרות בפורטל — פועלי ריצוף באזור המרכז',
    meta: { profession_code: 'flooring', region_code: 'center', count: 8, opportunity_type: 'match' },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'match_closed', cta_intent: 'post_requirement',
    text: 'פועלי שלד משובצים לקבלנים בפורטל — אזור צפון',
    meta: { profession_code: 'skeleton', region_code: 'north', count: 12 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'match_closed', cta_intent: 'post_requirement',
    text: 'רתכים משובצים לפרויקטים בפורטל — אזור דרום',
    meta: { profession_code: 'scaffolding', region_code: 'south', count: 5 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'match_closed', cta_intent: 'post_requirement',
    text: 'טייחים משובצים לפרויקטים בפורטל — אזור ירושלים',
    meta: { profession_code: 'plastering', region_code: 'jerusalem', count: 7 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'match_closed', cta_intent: 'post_requirement',
    text: 'פועלי גמרים משובצים לפרויקטים בפורטל — אזור מרכז',
    meta: { profession_code: 'painting', region_code: 'center', count: 10 },
    occurred_at: nextOccurred() },

  // ── service_new ─────────────────────────────────────────────────────
  // Also zeroed out today; copy pre-scrubbed for the eventual restore.
  { id: uid(), category: 'service_new', cta_intent: 'see_services',
    text: 'ספקי הסעות פעילים בפורטל — אזור מרכז',
    meta: { region_code: 'center', opportunity_type: 'service' },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'service_new', cta_intent: 'see_services',
    text: 'ספקי טיפול בוויזות פעילים בפורטל',
    meta: { opportunity_type: 'service' },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'service_new', cta_intent: 'see_services',
    text: 'ספקי ניהול עובדים זרים פעילים בפורטל — כל הארץ',
    meta: { region_code: 'national', opportunity_type: 'service' },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'service_new', cta_intent: 'see_services',
    text: 'ספקי ביטוח עובדים זרים פעילים בפורטל',
    meta: { opportunity_type: 'service' },
    occurred_at: nextOccurred() },

  // ── corp_active ─────────────────────────────────────────────────────
  { id: uid(), category: 'corp_active', cta_intent: 'post_availability',
    text: 'תאגידים מפרסמים כאן זמינות לרתכים',
    meta: { profession_code: 'scaffolding' },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'corp_active', cta_intent: 'post_availability',
    text: 'תאגידים מציגים כאן פועלי ריצוף זמינים',
    meta: { profession_code: 'flooring', count: 20 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'corp_active', cta_intent: 'post_availability',
    text: 'תאגידים מציעים כאן קבוצות טייחים מהודו',
    meta: { profession_code: 'plastering', origin_code: 'IN' },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'corp_active', cta_intent: 'post_availability',
    text: 'תאגידים מנהלים את הזמינות שלהם בפורטל',
    meta: { count: 15 },
    occurred_at: nextOccurred() },

  // ── contractor_active ───────────────────────────────────────────────
  { id: uid(), category: 'contractor_active', cta_intent: 'see_requirements',
    text: 'קבלנים בודקים התאמות בפורטל — אזור המרכז',
    meta: { region_code: 'center' },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'contractor_active', cta_intent: 'see_requirements',
    text: 'קבלנים משווים הצעות של תאגידים בפורטל',
    meta: { count: 45 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'contractor_active', cta_intent: 'see_requirements',
    text: 'קבלנים פותחים בקשות חדשות בפורטל',
    meta: { count: 3 },
    occurred_at: nextOccurred() },

  // ── platform_pulse ──────────────────────────────────────────────────
  { id: uid(), category: 'platform_pulse', cta_intent: 'see_requirements',
    text: 'בקשות חדשות נפתחות בפורטל מדי יום',
    meta: { count: 12 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'platform_pulse', cta_intent: 'check_match',
    text: 'עובדים חדשים מתווספים לפורטל מדי שבוע',
    meta: { count: 47 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'platform_pulse', cta_intent: 'see_requirements',
    text: 'ההיצע בפורטל גדל עם כל תאגיד חדש שמצטרף',
    occurred_at: nextOccurred() },
  { id: uid(), category: 'platform_pulse', cta_intent: 'check_match',
    text: 'עובדים זמינים מוצגים בפורטל מכל התאגידים',
    meta: { count: 200 },
    occurred_at: nextOccurred() },
  { id: uid(), category: 'platform_pulse', cta_intent: 'see_requirements',
    text: 'התאמות בין קבלנים לתאגידים נעשות בפורטל',
    meta: { count: 30 },
    occurred_at: nextOccurred() },
];

// TODO(feed): when GET /api/marketplace/activity-feed exists, swap
// MOCK_ITEMS for a live fetch here and restore the LIVE affordance
// on both LiveActivityFeed.tsx (bubble) and RoleLiveStrip.tsx
// (showcase). Copy above stays as fallback for the empty-feed path.
