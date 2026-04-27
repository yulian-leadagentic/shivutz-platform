-- =====================================================================
-- 014_deal_lifecycle_v2.sql
-- =====================================================================
--
-- Reshapes the deal lifecycle around the simplified billing model agreed
-- on 2026-04-27:
--
--   * Deal billing = accepted_count × single platform commission rate
--     (no per-corp tariff, no per-occupation tariff, no duration factor).
--   * Deal phases:
--       proposed         contractor sent inquiry; corp sees only
--                        profession + count + region; no charge
--       corp_committed   corp attached worker list; J5 hold placed
--                        for accepted_count × commission_per_worker_nis
--       approved         contractor approved the list; capture
--                        scheduled for now + capture_delay_hours
--       rejected         contractor rejected; J5 voided; workers unlocked
--       expired          contractor didn't act in approval_deadline_hours;
--                        J5 voided; workers unlocked
--       cancelled_by_corp corp backed out during the post-approval window;
--                        J5 voided; workers unlocked; admin urgent alert
--       closed           capture succeeded; invoice issued; workers stay
--                        locked to this deal (still allocated)
--
--   * Per-corporation pricing (corporation_pricing + commission_*
--     columns) is removed; the platform uses a single
--     `commission_per_worker_nis` setting.
--
--   * Workers gain `internal_id` (auto-generated EMP-XXXXXXXX shown to
--     contractor before approval) and `years_in_israel` (visible to
--     contractor pre-approval per the disclosure rules).
--
--   * Corporations gain `tc_signed_at` + `tc_version` so the onboarding
--     T&C acceptance is auditable.
--
-- Apply once:
--   docker-compose exec mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD \
--     < db/migrations/014_deal_lifecycle_v2.sql
--
-- Pre-launch state — destructive column drops without backfill, and the
-- deal status remap is best-effort across the small amount of test data.
-- =====================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────
-- 1. payment_db.system_settings — single platform commission + timing
--    knobs that drive the deal lifecycle.
-- ─────────────────────────────────────────────────────────────────────
USE payment_db;

INSERT INTO system_settings (setting_key, setting_value, value_type, description) VALUES
  ('commission_per_worker_nis', '500', 'number',
   'עמלת הפלטפורמה בש״ח לכל עובד שאוייש בעסקה (חיוב הקבלן). מקור יחיד.'),
  ('approval_deadline_hours',   '168', 'number',
   'שעות שיש לקבלן לאשר רשימת עובדים אחרי שהתאגיד שלח אותה. ברירת מחדל: 168 = 7 ימים.'),
  ('capture_delay_hours',        '48', 'number',
   'שעות בין אישור הקבלן לחיוב בפועל. במהלך החלון הזה התאגיד יכול לבטל ללא חיוב.'),
  ('admin_nudge_after_hours',    '24', 'number',
   'שעות שאחריהן מנהל המערכת מקבל התראה לדחוף את הקבלן לאשר רשימה ממתינה.')
ON DUPLICATE KEY UPDATE
  setting_value = VALUES(setting_value),
  value_type    = VALUES(value_type),
  description   = VALUES(description);

-- ─────────────────────────────────────────────────────────────────────
-- 2. deal_db — drop per-corp pricing + reshape deals + extend commissions
-- ─────────────────────────────────────────────────────────────────────
USE deal_db;

DROP TABLE IF EXISTS corporation_pricing;

-- Status remap: convert ENUM to VARCHAR, map values, then re-ENUM.
-- This preserves any test data without schema lock errors.
ALTER TABLE deals MODIFY COLUMN status VARCHAR(40) NOT NULL DEFAULT 'proposed';

UPDATE deals SET status='closed'            WHERE status IN ('completed');
UPDATE deals SET status='approved'          WHERE status IN ('reporting','active');
UPDATE deals SET status='corp_committed'    WHERE status IN ('accepted');
UPDATE deals SET status='cancelled_by_corp' WHERE status IN ('cancelled','disputed');
UPDATE deals SET status='proposed'          WHERE status IN ('counter_proposed');
-- Anything not matched above stays as-is; 'proposed' is also valid in the new enum.

ALTER TABLE deals
  DROP COLUMN agreed_price,
  DROP COLUMN currency,
  DROP COLUMN start_date,
  DROP COLUMN end_date,
  DROP COLUMN workers_count,
  DROP COLUMN contractor_report_submitted,
  DROP COLUMN corporation_report_submitted,
  DROP COLUMN discrepancy_flag,
  DROP COLUMN discrepancy_details;

ALTER TABLE deals
  ADD COLUMN commission_amount    DECIMAL(12,2) NULL
    COMMENT 'Set when corp commits the worker list: accepted_count * commission_per_worker_nis. Snapshot — not recomputed if rate changes later.',
  ADD COLUMN approved_at          DATETIME NULL,
  ADD COLUMN rejected_at          DATETIME NULL,
  ADD COLUMN expires_at           DATETIME NULL
    COMMENT 'corp_committed_at + approval_deadline_hours; cron expires deals past this if still corp_committed.',
  ADD COLUMN scheduled_capture_at DATETIME NULL
    COMMENT 'approved_at + capture_delay_hours; cron captures the J5 hold at or after this time unless the deal was cancelled.',
  ADD COLUMN cancelled_at         DATETIME NULL,
  ADD COLUMN cancelled_by         ENUM('corp') NULL,
  ADD COLUMN cancellation_reason  TEXT NULL,
  ADD COLUMN closed_at            DATETIME NULL;

ALTER TABLE deals MODIFY COLUMN status
  ENUM('proposed','corp_committed','approved','rejected','expired','cancelled_by_corp','closed')
  NOT NULL DEFAULT 'proposed';

ALTER TABLE deals
  ADD INDEX idx_expires_at (expires_at),
  ADD INDEX idx_scheduled_capture (scheduled_capture_at);

-- ─────────────────────────────────────────────────────────────────────
-- 3. worker_db — internal_id (visible to contractor pre-approval) +
--    years_in_israel (also visible pre-approval).
-- ─────────────────────────────────────────────────────────────────────
USE worker_db;

ALTER TABLE workers
  ADD COLUMN internal_id     VARCHAR(12) NULL
    COMMENT 'EMP-XXXXXXXX (8 random hex). Public-ish ID shown to contractors during deal review; never the internal UUID.',
  ADD COLUMN years_in_israel SMALLINT NULL
    COMMENT 'Years the worker has been in Israel (separate axis from experience_years which is trade experience).';

-- Backfill internal_id for any existing rows. MD5 of UUID gives a
-- random-looking 8-hex prefix; collision risk negligible at our scale.
UPDATE workers
SET internal_id = CONCAT('EMP-', UPPER(SUBSTRING(MD5(id), 1, 8)))
WHERE internal_id IS NULL;

ALTER TABLE workers
  MODIFY COLUMN internal_id VARCHAR(12) NOT NULL,
  ADD UNIQUE KEY uq_internal_id (internal_id);

-- ─────────────────────────────────────────────────────────────────────
-- 4. org_db — corp T&C acceptance + drop per-entity commission columns
-- ─────────────────────────────────────────────────────────────────────
USE org_db;

ALTER TABLE corporations
  ADD COLUMN tc_signed_at DATETIME    NULL
    COMMENT 'When the corp accepted Terms & Conditions during onboarding.',
  ADD COLUMN tc_version   VARCHAR(20) NULL
    COMMENT 'Version string of T&C accepted (allows future re-acceptance flow).';

ALTER TABLE corporations
  DROP COLUMN commission_per_worker_amount,
  DROP COLUMN commission_currency,
  DROP COLUMN commission_set_by_user_id,
  DROP COLUMN commission_set_at;

ALTER TABLE contractors
  DROP COLUMN commission_per_worker_amount,
  DROP COLUMN commission_currency,
  DROP COLUMN commission_set_by_user_id,
  DROP COLUMN commission_set_at,
  DROP COLUMN billing_enabled;
