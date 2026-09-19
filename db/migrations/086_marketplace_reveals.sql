-- 086 · marketplace_reveals audit table (R15 §3c)
--
-- POST /api/marketplace/{listing_id}/reveal returns contact_phone,
-- contact_name, corporation_name to any authenticated caller who
-- is NOT anonymous and NOT a pending contractor. The reveal itself
-- is NOT metered — services provided to workers (housing, transport,
-- insurance, equipment) are not the priced-reveal channel; worker-ad
-- reveals are (contact_reveals with tier quotas).
--
-- Why a separate table rather than an extra column on contact_reveals:
--   · contact_reveals is the quota substrate for worker reveals; the
--     monthly count off it drives basic=3 / advanced=20 / pro=unlimited.
--     Marketplace reveals must NOT decrement that quota.
--   · viewer_entity_type on contact_reveals is ENUM('contractor',
--     'corporation') — marketplace reveals accept service_provider too.
--     Widening the ENUM would ripple into every consumer of that column.
--
-- Idempotency: PRIMARY KEY on (viewer_entity_id, viewer_entity_type,
-- listing_id) collapses a viewer re-clicking "הצג פרטים" into a single
-- audit row — the first reveal is the only new event. `revealed_at`
-- reflects the FIRST time; on repeat the INSERT ... ON DUPLICATE KEY
-- UPDATE preserves it. If the endpoint is ever wired to a quota, add
-- a `revealed_count` column and bump it on duplicate instead.

USE org_db;

CREATE TABLE IF NOT EXISTS marketplace_reveals (
  viewer_entity_id   CHAR(36) NOT NULL,
  viewer_entity_type ENUM('contractor','corporation','service_provider') NOT NULL,
  listing_id         CHAR(36) NOT NULL,
  revealed_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (viewer_entity_id, viewer_entity_type, listing_id),
  KEY idx_listing (listing_id),
  KEY idx_viewer_time (viewer_entity_id, viewer_entity_type, revealed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
