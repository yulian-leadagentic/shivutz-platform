-- 065: D2 — promo_events for ROI attribution
--
-- promotions (migration 064) is the source-of-truth for boost spend.
-- promo_events records the *outcomes* attributable to a promotion so
-- we can compute cost-per-reveal, boost lift over baseline, and give
-- the corp a "did my ₪35 pay back" answer in their own dashboard.
--
-- Design notes:
--   * event_type is open-ended (VARCHAR not ENUM) so we can add new
--     kinds without a migration: 'impression', 'reveal', 'inquiry',
--     'ad_click', 'landing_click', etc.
--   * actor_entity_id is optional — impressions may be anonymous.
--   * promotion_id is nullable so we can also record baseline events
--     (no active promotion) and diff the two. When null, event still
--     ties to target_type/target_id.
--   * Composite index (promotion_id, event_type, at) supports the
--     canonical query: "give me reveals attributed to promo X".
--   * Read model built later — this migration just lays the pipe.

USE org_db;

CREATE TABLE promo_events (
  id                CHAR(36)      NOT NULL PRIMARY KEY,
  promotion_id      CHAR(36)      NULL,          -- FK to promotions.id (nullable = baseline event)
  event_type        VARCHAR(32)   NOT NULL,      -- impression | reveal | inquiry | ad_click | ...
  target_type       VARCHAR(24)   NOT NULL,      -- 'ad' | 'external' | 'landing_slot'
  target_id         CHAR(36)      NULL,          -- ads.id when target_type='ad'
  actor_entity_id   CHAR(36)      NULL,          -- viewing contractor (null = anonymous)
  actor_entity_type VARCHAR(16)   NULL,          -- 'contractor' | 'corporation' | NULL
  session_id        VARCHAR(64)   NULL,          -- for anon dedup of impressions
  metadata_json     JSON          NULL,          -- free-form (search-query, referrer, tier at time of event)
  at                TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_promo_type_time  (promotion_id, event_type, at),
  INDEX idx_target_type_time (target_type, target_id, event_type, at),
  INDEX idx_actor_time       (actor_entity_id, at),
  INDEX idx_event_time       (event_type, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
