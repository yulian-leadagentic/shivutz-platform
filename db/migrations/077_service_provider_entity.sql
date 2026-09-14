-- 077 · U7 §1 — service_provider as the third entity type.
--
-- Yulian, 14.09: "ספקים יישות מלאה עכשיו." — this migration is the
-- schema half of that decision. The runtime half (visibility gates,
-- registration route, RegistrationCTASection three-card render,
-- sponsor placements) lives in the code changes that ship
-- alongside this migration.
--
-- What this file does:
--
--   1. Adds 'service_provider' to every ENUM in the platform whose
--      values today are ('contractor','corporation'). Seven tables
--      spread across auth_db, org_db and payment_db. The DDL is
--      idempotent — running it a second time is a no-op — because
--      the value-add uses an INFORMATION_SCHEMA check (same pattern
--      as migration 022 that removed 'operator' from the role enum).
--
--   2. Creates the new `service_providers` table in org_db. Mirror
--      of `corporations` but with only the fields a provider
--      actually has: no gov_registry_matched_at (a provider is NOT
--      in the מרשם החברות corp registry — filed there IS the very
--      thing that would make them a corporation instead), no
--      kablan_number (that's the contractor's license), no
--      countries_of_origin (providers don't recruit workers). A
--      provider is a service seller — insurance, transport, housing
--      brokers, courses.
--
-- Rules for the ENUM edits, every time:
--   - ADD the value. Do not reorder, do not rename, do not remove.
--   - Rerunning must be a no-op.
--
-- Rules for the new table:
--   - `status` defaults to 'active' (see U7 §2: no registry to verify
--     against, so the account activates immediately after OTP —
--     admin later flips the trust badge to 'מאומת' by hand).
--   - `is_seed` matches contractors/corporations (S1 §1.2) so the
--     smoke test can identify seed providers when U7 tests land.

-- ── auth_db · three ENUMs ────────────────────────────────────────
USE auth_db;

-- entity_memberships.entity_type — 002:63.
-- This is THE gate for team-membership rows; every corp/contractor
-- portal join goes through it. A provider account with no team-
-- memberships row cannot sign in.
SET @ddl := IF(
  (SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='auth_db'
       AND TABLE_NAME='entity_memberships'
       AND COLUMN_NAME='entity_type') NOT LIKE '%service_provider%',
  'ALTER TABLE entity_memberships
     MODIFY COLUMN entity_type
     ENUM(''contractor'',''corporation'',''service_provider'') NOT NULL',
  'SELECT ''entity_memberships.entity_type already has service_provider''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- entity_documents.entity_type — 002:89.
SET @ddl := IF(
  (SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='auth_db'
       AND TABLE_NAME='entity_documents'
       AND COLUMN_NAME='entity_type') NOT LIKE '%service_provider%',
  'ALTER TABLE entity_documents
     MODIFY COLUMN entity_type
     ENUM(''contractor'',''corporation'',''service_provider'') NOT NULL',
  'SELECT ''entity_documents.entity_type already has service_provider''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- entity_audit.entity_type — 002:114.
SET @ddl := IF(
  (SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='auth_db'
       AND TABLE_NAME='entity_audit'
       AND COLUMN_NAME='entity_type') NOT LIKE '%service_provider%',
  'ALTER TABLE entity_audit
     MODIFY COLUMN entity_type
     ENUM(''contractor'',''corporation'',''service_provider'') NOT NULL',
  'SELECT ''entity_audit.entity_type already has service_provider''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- users.role — 001:17. Determines the JWT `role` claim → gateway
-- `x-user-role` header. Provider users must carry role='service_provider'
-- so gates that key off role behave correctly (they don't get bucketed
-- as 'corporation' by mistake — see U7 audit report row #26).
SET @ddl := IF(
  (SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='auth_db'
       AND TABLE_NAME='users'
       AND COLUMN_NAME='role') NOT LIKE '%service_provider%',
  'ALTER TABLE users
     MODIFY COLUMN role
     ENUM(''admin'',''contractor'',''corporation'',''staff'',''service_provider'') NOT NULL',
  'SELECT ''users.role already has service_provider''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- users.org_type — 001:19. Nullable legacy denorm. /auth/register
-- writes this alongside role for downstream services that still read
-- it. Provider registration UPDATEs org_type='service_provider' so
-- the enum must accept the value or MySQL strict-mode rejects the
-- write and the whole registration transaction rolls back.
SET @ddl := IF(
  (SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='auth_db'
       AND TABLE_NAME='users'
       AND COLUMN_NAME='org_type') NOT LIKE '%service_provider%',
  'ALTER TABLE users
     MODIFY COLUMN org_type
     ENUM(''contractor'',''corporation'',''service_provider'') NULL',
  'SELECT ''users.org_type already has service_provider''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── org_db · two ENUMs + the new table ───────────────────────────
USE org_db;

-- marketplace_subscriptions.advertiser_entity_type — 021:101.
-- Provider "subscriptions" are the FREE launch row (Yulian ok'd
-- חינם עד 31.12.2026). The row still needs a valid enum value.
SET @ddl := IF(
  (SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='org_db'
       AND TABLE_NAME='marketplace_subscriptions'
       AND COLUMN_NAME='advertiser_entity_type') NOT LIKE '%service_provider%',
  'ALTER TABLE marketplace_subscriptions
     MODIFY COLUMN advertiser_entity_type
     ENUM(''contractor'',''corporation'',''service_provider'') NOT NULL',
  'SELECT ''marketplace_subscriptions.advertiser_entity_type already has service_provider''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- marketplace_listings.advertiser_entity_type — 021:145. NULL-able
-- (matches the migration that added it).
SET @ddl := IF(
  (SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='org_db'
       AND TABLE_NAME='marketplace_listings'
       AND COLUMN_NAME='advertiser_entity_type') NOT LIKE '%service_provider%',
  'ALTER TABLE marketplace_listings
     MODIFY COLUMN advertiser_entity_type
     ENUM(''contractor'',''corporation'',''service_provider'') NULL',
  'SELECT ''marketplace_listings.advertiser_entity_type already has service_provider''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- org_users.org_type — 001:114. Legacy table (org_users is the
-- pre-L1 role table; entity_memberships replaced it). Kept in the
-- audit set so nothing that still reads it silently rejects a
-- provider row.
SET @ddl := IF(
  (SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='org_db'
       AND TABLE_NAME='org_users'
       AND COLUMN_NAME='org_type') NOT LIKE '%service_provider%',
  'ALTER TABLE org_users
     MODIFY COLUMN org_type
     ENUM(''contractor'',''corporation'',''service_provider'') NOT NULL',
  'SELECT ''org_users.org_type already has service_provider''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- service_providers · the new entity table.
--
-- Deliberately minimal per the U7 §1 rule "בלי kablan_number, בלי
-- corp_license, בלי שום שדה אימות מרשם. ספק אינו במרשם — שדה
-- שאף פעם לא יתמלא הוא חוב, לא גמישות."
CREATE TABLE IF NOT EXISTS service_providers (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()),
  name            VARCHAR(255) NOT NULL,
  business_number VARCHAR(100) NULL,           -- ח.פ / ע.מ — format-checked, NOT verified against a registry
  contact_name    VARCHAR(255) NOT NULL,
  contact_phone   VARCHAR(20)  NOT NULL,
  email           VARCHAR(255) NULL,
  city            VARCHAR(100) NULL,
  region          VARCHAR(50)  NULL,           -- enum code from `regions`, not a free-text
  website         VARCHAR(500) NULL,
  description     TEXT         NULL,
  logo_url        VARCHAR(500) NULL,
  -- 'active' by default: no registry to verify against, so OTP is
  -- enough to activate. Admin flips this to 'suspended' as a moderation
  -- action; there is no 'pending' state (see U7 §2).
  status          ENUM('pending','active','suspended') NOT NULL DEFAULT 'active',
  -- U7 §2 · trust badge state. NULL = "ספק · טרם אומת"; a value
  -- means an admin manually verified the provider. NULL is the
  -- shipping default; nobody starts verified.
  verified_at     DATETIME     NULL,
  verified_by_user_id CHAR(36) NULL,
  -- S1 §1.2 marker so the smoke test can identify seed providers
  -- once U7 tests land. Marker script (mark_seed_entities.py) is
  -- the only writer; every real registration ships with FALSE.
  is_seed         BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at      DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sp_business_number (business_number),
  INDEX idx_sp_status (status),
  INDEX idx_sp_deleted_at (deleted_at),
  INDEX idx_sp_is_seed (is_seed)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── payment_db · two ENUMs ───────────────────────────────────────
USE payment_db;

-- subscriptions.entity_type — 055:23. This is the paid-plan
-- subscription table. Providers are FREE at launch so no rows land
-- here for providers today, but the ENUM must accept the value so a
-- future upgrade path exists without a schema change.
SET @ddl := IF(
  (SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='payment_db'
       AND TABLE_NAME='subscriptions'
       AND COLUMN_NAME='entity_type') NOT LIKE '%service_provider%',
  'ALTER TABLE subscriptions
     MODIFY COLUMN entity_type
     ENUM(''contractor'',''corporation'',''service_provider'') NOT NULL',
  'SELECT ''subscriptions.entity_type already has service_provider''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- subscription_plans.entity_type — 059:17.
SET @ddl := IF(
  (SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='payment_db'
       AND TABLE_NAME='subscription_plans'
       AND COLUMN_NAME='entity_type') NOT LIKE '%service_provider%',
  'ALTER TABLE subscription_plans
     MODIFY COLUMN entity_type
     ENUM(''contractor'',''corporation'',''service_provider'') NOT NULL',
  'SELECT ''subscription_plans.entity_type already has service_provider''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
