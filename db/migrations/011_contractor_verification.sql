-- =====================================================================
-- 011_contractor_verification.sql — Contractor identity verification
-- =====================================================================
--
-- Three-tier verification model for contractor registrations, driven by
-- live cross-checks against two data.gov.il datasets:
--   pinkashakablanim   (פנקס הקבלנים)   — the only registry that exposes
--                                        per-contractor email + phone, so
--                                        it drives the channel choice for
--                                        magic-link / SMS verification.
--   ica_companies      (רשם החברות)     — used only to confirm that the
--                                        company is legally active
--                                        (פעילה / מחוקה / בפירוק).
--
-- Tiers:
--   tier_0  phone-OTP only — same browse permissions as tier_1
--   tier_1  registry confirmed but no contact-channel binding
--   tier_2  bound via email link, SMS OTP, or manual admin approval —
--           the only tier that may apply to corporations / pay / sign.
--
-- Run once:
--   docker-compose exec mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD \
--     org_db < db/migrations/011_contractor_verification.sql
--
-- Pre-launch state — no contractor data exists, so the dead `classification`
-- column is dropped outright (no backfill / compat shim).
-- =====================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
USE org_db;

-- ─────────────────────────────────────────────────────────────────────
-- 1. contractors — drop the typed-classification ENUM, add the
--    registry-sourced fields and the verification axis.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE contractors
  DROP COLUMN classification;

ALTER TABLE contractors
  ADD COLUMN kablan_number VARCHAR(20) NULL
    COMMENT 'מספר קבלן from פנקס הקבלנים (MISPAR_KABLAN). NULL until registry lookup succeeds.'
    AFTER business_number,
  ADD COLUMN kvutza CHAR(1) NULL
    COMMENT 'קבוצת סיווג — Hebrew letter from the registry (א, ב, ג, ד, ה).'
    AFTER kablan_number,
  ADD COLUMN sivug TINYINT UNSIGNED NULL
    COMMENT 'דרגת סיווג 1-5 within the kvutza. Combined display: kvutza-sivug e.g. "ג-3".'
    AFTER kvutza,
  ADD COLUMN gov_branch VARCHAR(100) NULL
    COMMENT 'TEUR_ANAF from פנקס הקבלנים, e.g. "בניה".'
    AFTER sivug,
  ADD COLUMN gov_company_status VARCHAR(40) NULL
    COMMENT 'סטטוס חברה from ica_companies (פעילה / מחוקה / בפירוק / ...). NULL for sole proprietors.'
    AFTER gov_branch;

ALTER TABLE contractors
  ADD COLUMN verification_tier
    ENUM('tier_0','tier_1','tier_2') NOT NULL DEFAULT 'tier_0'
    COMMENT 'tier_0 = phone-OTP only; tier_1 = registry-confirmed; tier_2 = principal-bound (email/sms/manual).',
  ADD COLUMN verification_method
    ENUM('email','sms','manual','none') NULL
    COMMENT 'How tier_2 was reached (NULL while tier < 2).',
  ADD COLUMN verified_at DATETIME NULL,
  ADD COLUMN revalidate_at DATETIME NULL
    COMMENT 'tier_2 contractors are re-checked against the registries every 6 months — set to verified_at + 6mo.';

ALTER TABLE contractors
  ADD INDEX idx_verification_tier (verification_tier),
  ADD INDEX idx_revalidate_at (revalidate_at);

-- Sanity constraint: contractors cannot register without a 9-digit
-- business_number that passes the Israeli ID checksum (enforced in app
-- code; we only enforce length here to catch stray bad data).
ALTER TABLE contractors
  MODIFY COLUMN business_number VARCHAR(9) NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 2. gov_registry_cache — TTL'd cache of data.gov.il responses keyed by
--    the contractor's business_number. Lookup logic in the app treats
--    rows older than 7 days as stale.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gov_registry_cache (
  business_number   VARCHAR(9)   NOT NULL,
  pinkash_payload   JSON         NULL
    COMMENT 'Raw row from pinkashakablanim — NULL means lookup ran and the contractor was not found.',
  ica_payload       JSON         NULL
    COMMENT 'Raw row from ica_companies — NULL means lookup ran and the company was not found (sole prop).',
  pinkash_found     BOOLEAN      NOT NULL DEFAULT FALSE,
  ica_found         BOOLEAN      NOT NULL DEFAULT FALSE,
  fetched_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (business_number),
  INDEX idx_fetched_at (fetched_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────
-- 3. verification_tokens — short-lived (30 min) tokens for the email
--    magic-link flow and the secondary SMS-OTP flow. Distinct from
--    auth_db.sms_otp because (a) the channel can be email, (b) the
--    code lives 30 minutes not 10, (c) it's tied to the contractor row
--    not a phone.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS verification_tokens (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()),
  contractor_id   CHAR(36)     NOT NULL,
  channel         ENUM('email','sms') NOT NULL,
  token_hash      VARCHAR(255) NOT NULL
    COMMENT 'sha256 hex of code (SMS) or single-use URL token (email).',
  target          VARCHAR(255) NOT NULL
    COMMENT 'The email address or phone the token was dispatched to.',
  expires_at      DATETIME     NOT NULL,
  used_at         DATETIME     NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_contractor_id (contractor_id),
  INDEX idx_token_hash (token_hash),
  INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Notification templates for the new verification events.
-- ─────────────────────────────────────────────────────────────────────

USE notif_db;

INSERT IGNORE INTO notification_templates
  (id, event_key, subject_he, subject_en, body_he, body_en, variables_schema)
VALUES
  (UUID(),
   'contractor.verify.email_link',
   'אימות חשבון קבלן בפלטפורמת שיבוץ',
   'Verify your contractor account on Shivutz',
   '<p>שלום {{contact_name}},</p><p>לאימות חשבונך בפלטפורמת שיבוץ, לחץ על הקישור הבא:</p><p><a href="{{magic_link}}">{{magic_link}}</a></p><p>הקישור תקף ל-{{expires_in_minutes}} דקות.</p><p>אם לא ביקשת אימות זה, אנא התעלם.</p>',
   '<p>Hello {{contact_name}},</p><p>To verify your Shivutz contractor account, click the link below:</p><p><a href="{{magic_link}}">{{magic_link}}</a></p><p>The link is valid for {{expires_in_minutes}} minutes.</p><p>If you did not request this verification, please ignore.</p>',
   '{"contact_name":"string","magic_link":"string","expires_in_minutes":"number"}'),

  (UUID(),
   'contractor.blocked.deleted_company',
   'התראה: ניסיון רישום של חברה במצב לא פעיל',
   'Alert: registration attempt for non-active company',
   '<p>בוצע ניסיון רישום של חברה הרשומה ברשם החברות במצב <b>{{company_status}}</b>.</p><ul><li>ח.פ: {{business_number}}</li><li>שם פונה: {{contact_name}}</li><li>טלפון: {{contact_phone}}</li><li>זמן: {{attempted_at}}</li></ul><p>הרישום נחסם אוטומטית.</p>',
   '<p>Registration attempt for a company recorded in the Companies Registry as <b>{{company_status}}</b>.</p><ul><li>Business #: {{business_number}}</li><li>Contact: {{contact_name}}</li><li>Phone: {{contact_phone}}</li><li>Time: {{attempted_at}}</li></ul><p>Registration was blocked automatically.</p>',
   '{"business_number":"string","company_status":"string","contact_name":"string","contact_phone":"string","attempted_at":"string"}'),

  (UUID(),
   'contractor.verification.expired',
   'אימות החשבון שלך בשיבוץ פג תוקף',
   'Your Shivutz contractor verification has expired',
   '<p>שלום {{contact_name}},</p><p>במהלך הבדיקה התקופתית של פנקס הקבלנים גילינו שהרישום של {{company_name}} כבר לא מופיע בפנקס.</p><p>כדי להמשיך להגיש בקשות לתאגידים יש לעבור אימות מחדש בהגדרות החשבון.</p>',
   '<p>Hello {{contact_name}},</p><p>During our periodic check of the Contractors Registry we noticed that {{company_name}} no longer appears.</p><p>To continue submitting applications to corporations, please re-verify your account in settings.</p>',
   '{"contact_name":"string","company_name":"string"}');
