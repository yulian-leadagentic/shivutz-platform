-- 054: contact_reveals audit (pivot/v2 Phase 3)
--
-- One row per "show me the corp's contact info" event a paying
-- contractor performs. Used for two things:
--   * audit / abuse defence (which entity revealed which ad when)
--   * Phase 5 per-tier quota counting (basic = 3/mo, advanced = 20/mo,
--     pro = unlimited — counted off this table)
--
-- Indexed by viewer+date so the quota check is a single fast count.

USE org_db;

CREATE TABLE IF NOT EXISTS contact_reveals (
  id                 CHAR(36) PRIMARY KEY,
  viewer_entity_id   CHAR(36) NOT NULL,
  viewer_entity_type ENUM('contractor','corporation') NOT NULL,
  ad_id              CHAR(36) NOT NULL,
  revealed_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_viewer_time (viewer_entity_id, viewer_entity_type, revealed_at),
  KEY idx_ad (ad_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
