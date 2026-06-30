-- 053: ads table (pivot/v2 Phase 2)
--
-- Single table for both worker ads and housing ads (Phase 4 ships
-- housing UI; columns are present now to avoid migration churn). Owner
-- is always a corporation in pivot/v2 — Q4 of pivot planning: "Corps
-- also publish housing." Schema discriminator is `ad_type`.
--
-- Lifecycle:
--   active        — visible on contractor search (Phase 3)
--   deleted_at    — soft delete (set, never DELETE-d)
--   expires_at    — auto-hides from search after this timestamp
--   featured_until — boosted ad, ranks higher in search results (Phase 5)
--
-- title_he + body_he are the embedding-input columns for Phase 5
-- vector rerank; they hold whatever free text the corp typed about
-- the worker/housing offering. The structured columns are used by
-- the SQL prefilter in Phase 3.

USE org_db;

CREATE TABLE IF NOT EXISTS ads (
  id                       CHAR(36)     PRIMARY KEY,
  owner_entity_id          CHAR(36)     NOT NULL,
  owner_entity_type        ENUM('corporation') NOT NULL DEFAULT 'corporation',
  ad_type                  ENUM('worker','housing') NOT NULL,

  -- Free-text fields (used by Phase 5 vector rerank)
  title_he                 VARCHAR(255) NOT NULL,
  body_he                  TEXT         NULL,

  -- Worker fields (NULL for housing)
  profession_code          VARCHAR(64)  NULL,
  origin_country           VARCHAR(8)   NULL,
  region                   VARCHAR(64)  NULL,
  quantity                 INT          NULL,
  experience_min_months    INT          NULL,
  visa_valid_until         DATE         NULL,
  languages                JSON         NULL,

  -- Housing fields (NULL for worker — Phase 4 surface)
  city                     VARCHAR(64)  NULL,
  address_he               VARCHAR(255) NULL,
  total_beds               INT          NULL,
  available_beds           INT          NULL,
  price_per_bed_nis        INT          NULL,
  amenities                JSON         NULL,
  photos                   JSON         NULL,

  -- Lifecycle
  active                   BOOLEAN      NOT NULL DEFAULT TRUE,
  published_at             TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  expires_at               DATETIME     NULL,
  featured_until           DATETIME     NULL,
  view_count               INT          NOT NULL DEFAULT 0,

  created_at               TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at               TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at               TIMESTAMP    NULL,

  KEY idx_owner_active (owner_entity_id, active, deleted_at),
  KEY idx_type_active  (ad_type, active, deleted_at, expires_at),
  KEY idx_featured     (featured_until, active, deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
