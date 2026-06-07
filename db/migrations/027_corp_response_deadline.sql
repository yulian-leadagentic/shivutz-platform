-- 027: 48-hour corp-response deadline tracking.
--
-- Adds the business setting + the bookkeeping column needed to:
--   * show a HH:MM:SS countdown on the contractor + corp views
--     for every deal still in `proposed` state (the corp hasn't
--     committed workers yet),
--   * notify admin (SMS + in-app banner) ONCE per deal when that
--     deadline elapses without the corp acting,
--   * sort the corp's incoming requests list by smallest-time-
--     remaining first.

-- ── 1. Business setting — how long the corp has to respond ─────
USE payment_db;

INSERT INTO system_settings (setting_key, setting_value, value_type, description) VALUES
  ('corp_response_hours', '48', 'number',
   'שעות שיש לתאגיד להגיב לפנייה (סטטוס proposed) לפני שמנהל המערכת מקבל התראה. ברירת מחדל: 48.')
ON DUPLICATE KEY UPDATE
  setting_value = VALUES(setting_value),
  value_type    = VALUES(value_type),
  description   = VALUES(description);

-- ── 2. Idempotency column on deals ─────────────────────────────
-- The cron sweep that fires admin notifications uses this to make
-- sure each deal triggers exactly one notification, even if it
-- sits past the deadline for days before the corp eventually
-- responds (which is allowed — late commits are not blocked).
--
-- MySQL 8.0 doesn't support `ADD COLUMN IF NOT EXISTS` in
-- ALTER TABLE, so we guard manually via information_schema.
USE deal_db;

SET @exists := (
  SELECT COUNT(*)
    FROM information_schema.COLUMNS
   WHERE table_schema = 'deal_db'
     AND table_name   = 'deals'
     AND column_name  = 'proposed_admin_notified_at'
);

SET @sql := IF(@exists = 0,
  'ALTER TABLE deals ADD COLUMN proposed_admin_notified_at TIMESTAMP NULL DEFAULT NULL AFTER expires_at',
  'SELECT 1');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
