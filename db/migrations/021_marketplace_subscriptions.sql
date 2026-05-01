-- =====================================================================
-- 021_marketplace_subscriptions.sql
-- =====================================================================
-- Phase 2.0 of the Yad2-style marketplace.
--
-- The existing `marketplace_listings` (migration 007) is a free, post-
-- and-show-phone V0. This migration introduces the foundation for paid,
-- subscription-gated publishing:
--
-- 1. `marketplace_categories` — admin-managed list of categories.
--    Replaces the hardcoded category strings in the frontend. Initial
--    seed: housing (renamed label "דיור להשכרה" — covers worker housing
--    AND residential rentals), equipment, services, other.
--
-- 2. `marketplace_subscription_tiers` — per-category pricing bundles.
--    Each tier defines: how many concurrent listings, for how many
--    days, at what price. Seeded with Basic + Premium per category;
--    admin can edit / add tiers via the new admin UI.
--
-- 3. `marketplace_subscriptions` — an advertiser's purchased
--    subscription. One row per (advertiser, category, period). Tracks
--    expires_at + auto_renew + cardcom_token_ref for the renewal cron
--    in phase 2.3.
--
-- 4. `marketplace_listings` — extended with `subscription_id`,
--    `advertiser_entity_type`, `advertiser_entity_id`. The existing
--    `corporation_id` column is left in place (existing rows back-
--    filled) so phase 2.0 doesn't break the currently-shipped read
--    path; the actual switch to advertiser_entity_* happens in 2.1.
--
-- All ALTER COLUMN guards use INFORMATION_SCHEMA lookups so the file
-- is idempotent and safe to re-apply.
-- =====================================================================

USE org_db;

-- ── 1. Categories ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS marketplace_categories (
  code            VARCHAR(50)    NOT NULL,
  name_he         VARCHAR(120)   NOT NULL,
  name_en         VARCHAR(120)   NOT NULL,
  name_ar         VARCHAR(120)   NULL,
  icon_slug       VARCHAR(40)    NULL,
  sort_order      SMALLINT       NOT NULL DEFAULT 0,
  is_active       BOOLEAN        NOT NULL DEFAULT TRUE,
  created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (code),
  INDEX idx_mc_active_sort (is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO marketplace_categories (code, name_he, name_en, name_ar, icon_slug, sort_order) VALUES
  ('housing',   'דיור להשכרה',          'Housing for rent',  'سكن للإيجار',         'home',     10),
  ('equipment', 'ציוד וכלי עבודה',      'Equipment & tools', 'معدات وأدوات',         'wrench',   20),
  ('services',  'שירותים',              'Services',          'خدمات',                 'tools',    30),
  ('other',     'כללי',                 'Other',             'متنوع',                 'package',  40);

-- ── 2. Subscription tiers ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS marketplace_subscription_tiers (
  id              CHAR(36)       NOT NULL DEFAULT (UUID()),
  category_code   VARCHAR(50)    NOT NULL,
  name_he         VARCHAR(80)    NOT NULL,
  name_en         VARCHAR(80)    NOT NULL,
  slot_count      SMALLINT       NOT NULL,
  duration_days   SMALLINT       NOT NULL,
  price_nis       DECIMAL(10,2)  NOT NULL,
  is_active       BOOLEAN        NOT NULL DEFAULT TRUE,
  sort_order      SMALLINT       NOT NULL DEFAULT 0,
  created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Two tiers within the same category can't share the same English
  -- name. Doubles as a business rule and as the deduplication key for
  -- the seed INSERT IGNOREs below — re-applying this migration against
  -- a polluted DB won't create duplicate tier rows.
  UNIQUE KEY uq_mst_cat_name (category_code, name_en),
  INDEX idx_mst_category_active (category_code, is_active, sort_order),
  CONSTRAINT fk_mst_category FOREIGN KEY (category_code)
    REFERENCES marketplace_categories(code) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed two starter tiers per category. Admin can edit / add via UI.
INSERT IGNORE INTO marketplace_subscription_tiers
  (id, category_code, name_he, name_en, slot_count, duration_days, price_nis, sort_order)
VALUES
  (UUID(), 'housing',   'בסיסי',   'Basic',   5,  30, 199.00, 10),
  (UUID(), 'housing',   'מקצועי',  'Premium', 20, 30, 499.00, 20),
  (UUID(), 'equipment', 'בסיסי',   'Basic',   5,  30, 149.00, 10),
  (UUID(), 'equipment', 'מקצועי',  'Premium', 20, 30, 399.00, 20),
  (UUID(), 'services',  'בסיסי',   'Basic',   5,  30, 149.00, 10),
  (UUID(), 'services',  'מקצועי',  'Premium', 20, 30, 399.00, 20),
  (UUID(), 'other',     'בסיסי',   'Basic',   5,  30,  99.00, 10),
  (UUID(), 'other',     'מקצועי',  'Premium', 20, 30, 299.00, 20);

-- ── 3. Subscriptions purchased by advertisers ─────────────────────────

CREATE TABLE IF NOT EXISTS marketplace_subscriptions (
  id                       CHAR(36)       NOT NULL DEFAULT (UUID()),
  advertiser_entity_type   ENUM('contractor','corporation') NOT NULL,
  advertiser_entity_id     CHAR(36)       NOT NULL,
  category_code            VARCHAR(50)    NOT NULL,
  tier_id                  CHAR(36)       NOT NULL,
  -- Snapshot fields — frozen at purchase so a tier edit later doesn't
  -- retroactively change the advertiser's quota or end-date.
  slot_count               SMALLINT       NOT NULL,
  duration_days            SMALLINT       NOT NULL,
  price_nis                DECIMAL(10,2)  NOT NULL,
  expires_at               DATETIME       NOT NULL,
  auto_renew               BOOLEAN        NOT NULL DEFAULT TRUE,
  status                   ENUM('active','expired','cancelled') NOT NULL DEFAULT 'active',
  cardcom_token_ref        VARCHAR(255)   NULL,
  payment_transaction_id   CHAR(36)       NULL,
  last_renewal_attempt_at  DATETIME       NULL,
  last_renewal_error       TEXT           NULL,
  cancelled_at             DATETIME       NULL,
  created_at               DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_ms_advertiser (advertiser_entity_type, advertiser_entity_id, status),
  INDEX idx_ms_status_expires (status, expires_at),
  INDEX idx_ms_renewal_due (auto_renew, status, expires_at),
  CONSTRAINT fk_ms_category FOREIGN KEY (category_code)
    REFERENCES marketplace_categories(code) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_ms_tier FOREIGN KEY (tier_id)
    REFERENCES marketplace_subscription_tiers(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 4. Extend marketplace_listings ────────────────────────────────────
-- Idempotent ADD COLUMN guards (MySQL 8 doesn't have ADD COLUMN IF NOT EXISTS
-- for ALTER TABLE; use INFORMATION_SCHEMA pattern from migration 019).

SET @ddl := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='org_db' AND TABLE_NAME='marketplace_listings' AND COLUMN_NAME='subscription_id') = 0,
  'ALTER TABLE marketplace_listings ADD COLUMN subscription_id CHAR(36) NULL AFTER corporation_id',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='org_db' AND TABLE_NAME='marketplace_listings' AND COLUMN_NAME='advertiser_entity_type') = 0,
  'ALTER TABLE marketplace_listings ADD COLUMN advertiser_entity_type ENUM(''contractor'',''corporation'') NULL AFTER subscription_id',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='org_db' AND TABLE_NAME='marketplace_listings' AND COLUMN_NAME='advertiser_entity_id') = 0,
  'ALTER TABLE marketplace_listings ADD COLUMN advertiser_entity_id CHAR(36) NULL AFTER advertiser_entity_type',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill: every existing row was a corporation listing (the only
-- advertiser type the V0 supported).
UPDATE marketplace_listings
   SET advertiser_entity_type = 'corporation',
       advertiser_entity_id   = corporation_id
 WHERE advertiser_entity_id IS NULL;

-- Index on the new advertiser dimension for fast "my listings" queries
-- once phase 2.1 swaps the read path off corporation_id.
SET @ddl := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA='org_db' AND TABLE_NAME='marketplace_listings' AND INDEX_NAME='idx_ml_advertiser') = 0,
  'ALTER TABLE marketplace_listings ADD INDEX idx_ml_advertiser (advertiser_entity_type, advertiser_entity_id, status)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA='org_db' AND TABLE_NAME='marketplace_listings' AND INDEX_NAME='idx_ml_subscription') = 0,
  'ALTER TABLE marketplace_listings ADD INDEX idx_ml_subscription (subscription_id)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
