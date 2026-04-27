-- =====================================================================
-- 009_payment_preauth.sql — Pattern A (J5 pre-authorization) support
-- =====================================================================
--
-- Adds columns + settings for the J5 pre-auth flow:
--   commit → Cardcom holds the amount on the card (J5)
--   grace window (default 48h)
--   capture → real charge  (or)  void → hold released
--
-- Run against an existing DB once:
--   docker-compose exec mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD \
--     payment_db < db/migrations/009_payment_preauth.sql
--
-- Re-running is safe for the settings (INSERT IGNORE) but the ALTER TABLE
-- column adds are NOT idempotent — they'll error on the second run.
-- =====================================================================

USE payment_db;

-- ── payment_transactions: columns for the J5 authorization lifecycle ──

ALTER TABLE payment_transactions
  ADD COLUMN auth_provider_deal_id VARCHAR(128) NULL
    COMMENT 'Cardcom InternalDealNumber of the J5 authorization — used for capture/void',
  ADD COLUMN auth_expires_at DATETIME NULL
    COMMENT 'When the Cardcom hold auto-voids if not captured (typically 7–30 days post-auth)',
  ADD COLUMN authorized_at DATETIME NULL
    COMMENT 'Timestamp the J5 authorization succeeded',
  ADD COLUMN last_capture_error TEXT NULL
    COMMENT 'Most recent error message from a capture attempt (debug / admin view)',
  ADD COLUMN last_capture_attempt_at DATETIME NULL,
  ADD COLUMN simulate_next_capture_fails BOOLEAN NOT NULL DEFAULT FALSE
    COMMENT 'Simulation-only: if TRUE, the next capture attempt fails synthetically (admin testing only)';

-- Scheduler sweep — "authorized rows whose grace expired" runs this pattern
-- every minute; the composite index makes the scan cheap.
ALTER TABLE payment_transactions
  ADD INDEX idx_pt_status_grace (status, grace_period_expires_at);

-- ── system_settings: new keys for Pattern A ──
--
-- grace_period_hours supersedes the older grace_period_days for the new flow.
-- The old key is left in place so existing code paths keep working until
-- the backend is switched over in a later commit.

INSERT IGNORE INTO system_settings (setting_key, setting_value, value_type, description) VALUES
  ('grace_period_hours',             '48', 'number',
   'שעות בין אישור ההתחייבות לחיוב האוטומטי בפועל (J5 → capture). מחליף grace_period_days.'),
  ('capture_retry_interval_minutes', '60', 'number',
   'דקות המתנה בין ניסיונות capture לאחר כישלון, לפני הכרזה על capture_failed_final');

-- max_charge_retries already exists at default '3' — leaving it as-is; this
-- is the same knob controlling how many capture attempts we make before
-- marking capture_failed_final and notifying admin.
