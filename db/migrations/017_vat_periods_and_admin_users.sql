-- =====================================================================
-- 017_vat_periods_and_admin_users.sql
-- =====================================================================
--
-- (1) Replaces the single `system_settings.vat_rate` value with a multi-
--     period table so admin can schedule a VAT change in advance and
--     historical charges keep their original rate.
--
--     Lookup at charge time: pick the period where
--       valid_from ≤ charge_date AND (valid_until IS NULL OR valid_until ≥ charge_date)
--     If multiple match (overlap), the one with the latest valid_from wins.
--     If none match (gap), the payment service raises `vat_period_missing`.
--
-- (2) Adds the notification template for the new `admin.user.added` event
--     (SMS-only — see notification handler).
--
-- Apply once.
-- =====================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────
-- 1. payment_db.vat_periods
-- ─────────────────────────────────────────────────────────────────────
USE payment_db;

CREATE TABLE IF NOT EXISTS vat_periods (
  id                 CHAR(36)      NOT NULL DEFAULT (UUID()),
  percent            DECIMAL(5,2)  NOT NULL
    COMMENT 'VAT percentage as a number, not a fraction. e.g. 18.00 = 18%.',
  valid_from         DATE          NOT NULL,
  valid_until        DATE          NULL
    COMMENT 'Inclusive end. NULL = open-ended (current period).',
  notes              VARCHAR(255)  NULL,
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id CHAR(36)      NULL,
  PRIMARY KEY (id),
  INDEX idx_vat_valid_from (valid_from),
  INDEX idx_vat_valid_until (valid_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed: migrate the existing single value to one open-ended period.
-- Reads the current `system_settings.vat_rate` (stored as a fraction like
-- "0.18") and converts to a percent column ("18.00"). Falls back to 18%.
INSERT INTO vat_periods (percent, valid_from, valid_until, notes)
SELECT
  ROUND(CAST(setting_value AS DECIMAL(8,4)) * 100, 2) AS percent,
  '2020-01-01' AS valid_from,
  NULL          AS valid_until,
  'מיגרציה אוטומטית מ-system_settings.vat_rate' AS notes
FROM system_settings
WHERE setting_key = 'vat_rate'
  AND NOT EXISTS (SELECT 1 FROM vat_periods);

-- If for any reason the seed found nothing, ensure there's at least one
-- row so charges don't fail immediately.
INSERT INTO vat_periods (percent, valid_from, valid_until, notes)
SELECT 18.00, '2020-01-01', NULL, 'ברירת מחדל'
WHERE NOT EXISTS (SELECT 1 FROM vat_periods);

-- Drop the old single-value setting now that the table is the source of truth.
DELETE FROM system_settings WHERE setting_key = 'vat_rate';

-- ─────────────────────────────────────────────────────────────────────
-- 2. Notification template for admin.user.added
-- ─────────────────────────────────────────────────────────────────────
USE notif_db;

INSERT INTO notification_templates
  (id, event_key, subject_he, subject_en, body_he, body_en, variables_schema)
VALUES
  (UUID(),
   'admin.user.added',
   'נוספת כמנהל בפלטפורמת שיבוץ',
   'You were added as an admin on Shivutz',
   '<div dir="rtl" lang="he"><p>שלום {{contact_name}},</p><p>נוספת כמנהל מערכת בפלטפורמת שיבוץ.</p><p>היכנס בכתובת <a href="{{login_url}}">{{login_url}}</a> עם מספר הטלפון הזה — קוד OTP יישלח אליך לאימות.</p></div>',
   '<div dir="ltr" lang="en"><p>Hello {{contact_name}},</p><p>You have been added as an administrator on the Shivutz platform.</p><p>Sign in at <a href="{{login_url}}">{{login_url}}</a> using this phone number — an OTP code will be sent to you.</p></div>',
   '{"contact_name":"string","login_url":"string"}')
ON DUPLICATE KEY UPDATE
  subject_he = VALUES(subject_he),
  subject_en = VALUES(subject_en),
  body_he = VALUES(body_he),
  body_en = VALUES(body_en),
  variables_schema = VALUES(variables_schema),
  is_active = TRUE,
  updated_at = NOW();
