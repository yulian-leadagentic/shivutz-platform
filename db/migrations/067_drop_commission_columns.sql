-- 067: D3 — drop commission columns from contractors + corporations
--
-- The pivot model earns from subscriptions + reveals + boosts; there's
-- no per-deal commission any more. Step 1 of D3 removed all
-- reads/writes/UI/endpoints that touched these columns. This migration
-- drops the columns themselves + the platform-wide setting row.
--
-- IDEMPOTENT — checks each column exists before dropping. The naive
-- `ALTER TABLE contractors DROP COLUMN commission_currency, ...` form
-- failed on staging (MySQL 1091 "Can't DROP; check that column/key
-- exists") because a partial earlier run had already dropped some of
-- the columns. This version can be re-applied on any environment
-- regardless of which columns are still present.
--
-- Pattern: SET a prepared-statement string via SELECT IF(...), then
-- PREPARE / EXECUTE / DEALLOCATE. Falls back to `DO 0` (no-op) when
-- the column is already gone. Works on MySQL 5.7 without stored
-- procedures — the runner doesn't support DELIMITER (see run_migrations.py
-- + Railway-deployment memory).
--
-- Pre-launch: no live data, no rollback plan required. See DOWN block
-- at the bottom for how to reverse if a dev DB needs to be restored to
-- pre-D3 state.

USE org_db;

-- ── contractors ──────────────────────────────────────────────────
SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='contractors'
       AND COLUMN_NAME='commission_per_worker_amount') > 0,
  'ALTER TABLE contractors DROP COLUMN commission_per_worker_amount', 'DO 0'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='contractors'
       AND COLUMN_NAME='commission_currency') > 0,
  'ALTER TABLE contractors DROP COLUMN commission_currency', 'DO 0'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='contractors'
       AND COLUMN_NAME='commission_set_by_user_id') > 0,
  'ALTER TABLE contractors DROP COLUMN commission_set_by_user_id', 'DO 0'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='contractors'
       AND COLUMN_NAME='commission_set_at') > 0,
  'ALTER TABLE contractors DROP COLUMN commission_set_at', 'DO 0'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── corporations ─────────────────────────────────────────────────
SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='corporations'
       AND COLUMN_NAME='commission_per_worker_amount') > 0,
  'ALTER TABLE corporations DROP COLUMN commission_per_worker_amount', 'DO 0'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='corporations'
       AND COLUMN_NAME='commission_currency') > 0,
  'ALTER TABLE corporations DROP COLUMN commission_currency', 'DO 0'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='corporations'
       AND COLUMN_NAME='commission_set_by_user_id') > 0,
  'ALTER TABLE corporations DROP COLUMN commission_set_by_user_id', 'DO 0'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='corporations'
       AND COLUMN_NAME='commission_set_at') > 0,
  'ALTER TABLE corporations DROP COLUMN commission_set_at', 'DO 0'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

USE payment_db;

-- Already idempotent — DELETE against a missing row is a no-op.
DELETE FROM system_settings WHERE setting_key = 'commission_per_worker_nis';

-- ── DOWN ──────────────────────────────────────────────────────────
-- Reverses this migration for a fresh dev DB. Not applied
-- automatically — the run_migrations runner is up-only. Copy/paste
-- into a MySQL session if needed.
--
-- USE org_db;
--
-- ALTER TABLE contractors
--   ADD COLUMN commission_per_worker_amount DECIMAL(10,2) NOT NULL DEFAULT 500.00,
--   ADD COLUMN commission_currency          VARCHAR(3)    NOT NULL DEFAULT 'ILS',
--   ADD COLUMN commission_set_by_user_id    CHAR(36)      NULL,
--   ADD COLUMN commission_set_at            DATETIME      NULL;
--
-- ALTER TABLE corporations
--   ADD COLUMN commission_per_worker_amount DECIMAL(10,2) NOT NULL DEFAULT 500.00,
--   ADD COLUMN commission_currency          VARCHAR(3)    NOT NULL DEFAULT 'ILS',
--   ADD COLUMN commission_set_by_user_id    CHAR(36)      NULL,
--   ADD COLUMN commission_set_at            DATETIME      NULL;
--
-- USE payment_db;
--
-- INSERT IGNORE INTO system_settings (setting_key, setting_value, value_type, description)
--   VALUES ('commission_per_worker_nis', '500', 'number',
--           'Platform commission charged per accepted worker (₪).');
