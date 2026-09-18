-- 080 · R5 §2b · service_providers.primary_category
--
-- Yulian 17.09: "התהליך צריך להיות שאני בוחר קודם קטגוריה שאליה אני שייך —
-- דיור, הסעות וכו', לפי מה שזמין באתר."
--
-- primary_category is an ASSOCIATION, not a gate. A provider can still
-- publish listings in other categories (R5 §2b guardrail). The column
-- is what the marketplace search + admin dashboards use to bucket a
-- provider by trade, and what /marketplace/new prefills as the default.
--
-- Value is the marketplace_categories.code — same enum the public
-- categories endpoint (marketplace.py:198) already exposes. NOT a FK
-- because that table is owned by user-org and the reference would
-- cross the org_db/marketplace boundary; the endpoint validates it
-- exists at write time instead.
--
-- Idempotent — safe to re-run.

USE org_db;

SET @ddl := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='org_db'
       AND TABLE_NAME='service_providers'
       AND COLUMN_NAME='primary_category') = 0,
  'ALTER TABLE service_providers
     ADD COLUMN primary_category VARCHAR(64) NULL
       COMMENT ''marketplace_categories.code — trade the provider self-selected at signup. Association, not a gate.''
     AFTER business_number',
  'SELECT ''service_providers.primary_category already exists''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Index for admin filter + future /admin/providers?category=… listing.
SET @ddl := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA='org_db'
       AND TABLE_NAME='service_providers'
       AND INDEX_NAME='idx_sp_primary_category') = 0,
  'ALTER TABLE service_providers
     ADD INDEX idx_sp_primary_category (primary_category)',
  'SELECT ''idx_sp_primary_category already exists''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
