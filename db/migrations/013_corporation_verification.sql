-- =====================================================================
-- 013_corporation_verification.sql — Corporation verification axis
-- =====================================================================
--
-- Mirrors the contractor verification model on the corporations table,
-- with two differences:
--   1. Only `ica_companies` (רשם החברות) is consulted at registration —
--      פנקס הקבלנים is irrelevant for corporations, so there's no
--      kvutza/sivug/kablan_number column.
--   2. There is no email/sms self-verification path — the only way to
--      reach tier_2 is admin approval, since "permitted to bring foreign
--      workers" is not an axis exposed in any open dataset.
--
-- Tier semantics for corporations:
--   tier_0  phone-OTP only — same browse permissions as tier_1
--   tier_1  ica_companies confirmed the company is active (or sole prop)
--   tier_2  admin approved as "תאגיד מאושר" — ONLY tier that may
--           publish/offer workers
--
-- Apply once:
--   docker-compose exec mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD \
--     org_db < db/migrations/013_corporation_verification.sql
-- =====================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
USE org_db;

ALTER TABLE corporations
  ADD COLUMN gov_company_status VARCHAR(40) NULL
    COMMENT 'סטטוס חברה from ica_companies (פעילה / מחוקה / בפירוק / ...)'
    AFTER business_number,
  ADD COLUMN verification_tier
    ENUM('tier_0','tier_1','tier_2') NOT NULL DEFAULT 'tier_0'
    COMMENT 'tier_0/1 = browsing only; tier_2 = approved by admin to publish/offer workers.',
  ADD COLUMN verification_method
    ENUM('email','sms','manual','none') NULL
    COMMENT 'For corporations only "manual" (admin-approved) or NULL is meaningful.',
  ADD COLUMN verified_at DATETIME NULL,
  ADD COLUMN revalidate_at DATETIME NULL;

ALTER TABLE corporations
  ADD INDEX idx_corp_verification_tier (verification_tier),
  ADD INDEX idx_corp_revalidate_at (revalidate_at);

ALTER TABLE corporations
  MODIFY COLUMN business_number VARCHAR(9) NOT NULL;
