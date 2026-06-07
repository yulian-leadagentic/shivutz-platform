// Live-activity feed — shared types between Phase 1 (mock) and Phase 2
// (real /api/marketplace/activity-feed endpoint). The shape here is the
// public contract: the view only ever reads `text` for display, and
// `meta` for decorative things (icons). When Phase 2 lands, only the
// data source changes — the view doesn't.

export type ActivityCategory =
  | 'workers_available'
  | 'requirement_new'
  | 'housing_new'
  | 'match_closed'
  | 'service_new'
  | 'corp_active'
  | 'contractor_active'
  | 'platform_pulse';

export type CtaIntent =
  | 'check_match'
  | 'see_requirements'
  | 'see_housing'
  | 'post_requirement'
  | 'see_services'
  | 'post_availability';

export interface ActivityItem {
  /** Stable per item — drives the suppression set (no item shown twice
   *  within ~3 minutes). Generated in mocks; UUIDs in Phase 2. */
  id: string;
  category: ActivityCategory;
  /** Pre-rendered Hebrew sentence. Phase 1: hand-written. Phase 2: the
   *  backend redactor produces it after applying privacy rules. The view
   *  reads ONLY this field for display text — never `meta`. */
  text: string;
  /** Decorative metadata for icons/tone. Never used for display strings. */
  meta?: {
    profession_code?: string;
    region_code?: string;
    origin_code?: string;
    /** Approximate count; ≤2 bucketed in Phase 2. */
    count?: number;
    opportunity_type?: 'worker' | 'requirement' | 'housing' | 'service' | 'match';
  };
  /** When the activity occurred. Drives the "לפני 4 דק׳" line. Phase 1
   *  generates these at module load time so every page-load looks fresh. */
  occurred_at: string;
  cta_intent: CtaIntent;
}

/** Weighting of categories in the rotation. 0 = never shown for this
 *  audience, 3 = highly favoured. Sums don't need to equal anything in
 *  particular — they're relative weights inside `createPicker`. */
export type Mix = Record<ActivityCategory, number>;

export type AudienceRole = 'anon' | 'contractor' | 'corporation';
