-- 067: D3 — drop commission columns from contractors + corporations
--
-- The pivot model earns from subscriptions + reveals + boosts; there's
-- no per-deal commission any more. Step 1 of D3 removed all
-- reads/writes/UI/endpoints that touched these columns. This migration
-- drops the columns themselves + the platform-wide setting row.
--
-- Pre-launch: no live data, no rollback plan required. See DOWN block
-- at the bottom for how to reverse if a dev DB needs to be restored to
-- pre-D3 state.

USE org_db;

ALTER TABLE contractors
  DROP COLUMN commission_per_worker_amount,
  DROP COLUMN commission_currency,
  DROP COLUMN commission_set_by_user_id,
  DROP COLUMN commission_set_at;

ALTER TABLE corporations
  DROP COLUMN commission_per_worker_amount,
  DROP COLUMN commission_currency,
  DROP COLUMN commission_set_by_user_id,
  DROP COLUMN commission_set_at;

USE payment_db;

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
