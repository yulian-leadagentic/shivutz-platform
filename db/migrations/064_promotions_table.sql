-- 064: D1 — separate promotions from ads
--
-- ads.featured_until served two conflicting jobs: it was both the
-- "is this ad currently boosted" flag AND the storage for paid-boost
-- period. Splitting them so:
--   * ads keeps featured_until as a DERIVED convenience column
--     (read path unchanged for now — search ordering, corp list)
--   * promotions is the source-of-truth for boost + external-ad
--     spend, ROI attribution (D2 will hang promo_events off it), and
--     future non-ad promo types (landing slot rentals, etc.)
--
-- Both write paths coexist during the transition: /ads/boost inserts
-- a promotion row AND stamps ads.featured_until so any code that
-- still reads ads.featured_until (search/list) keeps working. Full
-- drop of featured_until waits for Wave 5 D2 when read paths swap.

USE org_db;

CREATE TABLE promotions (
  id             CHAR(36)      NOT NULL PRIMARY KEY,
  kind           VARCHAR(24)   NOT NULL,      -- 'boost' | 'external'
  target_type    VARCHAR(24)   NULL,          -- 'ad' when kind='boost'; NULL for external
  target_id      CHAR(36)      NULL,          -- ad.id when target_type='ad'
  owner_entity_id   CHAR(36)   NULL,          -- corporation paying for the promo
  owner_entity_type VARCHAR(16) NULL,
  starts_at      TIMESTAMP     NOT NULL,
  ends_at        TIMESTAMP     NOT NULL,
  price_nis      INT           NULL,          -- flat per-day * days at time of purchase
  status         VARCHAR(16)   NOT NULL DEFAULT 'active',  -- 'active' | 'cancelled' | 'expired'
  created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_kind_status_ends (kind, status, ends_at),
  INDEX idx_target (target_type, target_id),
  INDEX idx_owner  (owner_entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Backfill: every ad currently boosted (featured_until > NOW()) gets
-- a matching promotion row so ROI accounting starts from a clean
-- slate. starts_at is approximated as ends_at - 7d (the default boost
-- duration); if we ever supported non-7d boosts, this loses precision
-- for the backfill — but no pre-launch data is at stake.
INSERT INTO promotions (id, kind, target_type, target_id,
                         owner_entity_id, owner_entity_type,
                         starts_at, ends_at, price_nis, status)
SELECT UUID(), 'boost', 'ad', a.id,
       a.owner_entity_id, 'corporation',
       DATE_SUB(a.featured_until, INTERVAL 7 DAY),
       a.featured_until,
       35,   -- BOOST_TOTAL_NIS default (5 ₪/day × 7 days)
       'active'
  FROM ads a
 WHERE a.featured_until IS NOT NULL
   AND a.featured_until > NOW()
   AND a.deleted_at IS NULL;
