-- R29 §1 · per-placement per-breakpoint sponsor creatives
--
-- Why a new table instead of extending sponsor_ads:
-- - migrations 069/078/084/092 are history — editing any of them
--   makes run_migrations.py:131-134 print a WARNING for every
--   deploy from here on, and an always-firing warning stops
--   warning about anything (R22 §2d rule).
-- - `sponsor_ads.creative_url` is one column; one creative can't
--   serve leaderboard (1200x150 · 8:1) AND carousel card
--   (640x360 · 16:9) AND mobile stack (720x300 · 2.4:1). R28 §4
--   proved this: a 1037x609 image (which passed R20's toothless
--   admin-side check) shrank to 340x200 in a 1120-wide leaderboard
--   slot because `contain` preserved the aspect. No CSS fixes it.
--
-- Selection order at render time (see R29 §1 Do):
--   1. sponsor_creatives WHERE placement=? AND breakpoint=?
--   2. sponsor_creatives WHERE placement=? AND breakpoint='desktop'
--   3. sponsor_ads.creative_url (the R20 §3 fallback, still valid)
--   4. sponsor_ads.headline_he / body_he / cta_label_he / brand_bg
--      / brand_fg (the composite render R29 §3 makes default for
--      wide-strip slots)
--
-- sponsor_ads.creative_url + creative_w + creative_h stay untouched
-- on purpose — they are the migration-92 fallback for every row that
-- was created before R29's per-slot uploads exist. NO data migration
-- in this round; existing rows keep rendering via step 3.

USE org_db;

SET @ddl := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA='org_db' AND TABLE_NAME='sponsor_creatives') = 0,
  'CREATE TABLE sponsor_creatives (
     id             CHAR(36)    NOT NULL PRIMARY KEY,
     sponsor_ad_id  CHAR(36)    NOT NULL,
     placement      VARCHAR(32) NOT NULL,
     breakpoint     ENUM(''desktop'', ''mobile'') NOT NULL,
     url            VARCHAR(500) NOT NULL,
     w              INT          NOT NULL,
     h              INT          NOT NULL,
     created_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     UNIQUE KEY uq_creative (sponsor_ad_id, placement, breakpoint),
     CONSTRAINT fk_creative_ad FOREIGN KEY (sponsor_ad_id) REFERENCES sponsor_ads(id) ON DELETE CASCADE
   )',
  'SELECT ''sponsor_creatives already exists''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- R29 §5 · admin-editable density ceiling. R28 §3's ancillary chip
-- row + the R29 §3-4 leaderboard/side_rail create a real risk of
-- turning the fold into an ad wall. site_settings already exists
-- (074_legal_documents_and_site_settings.sql) and already carries
-- `sponsor_carousel_limit` from 092, so this is one INSERT rather
-- than a new table.
INSERT INTO site_settings (setting_key, setting_val, label_he) VALUES
  ('sponsor_above_fold_limit', '2', 'מספר מקסימלי של יחידות פרסום מעל הקיפול')
ON DUPLICATE KEY UPDATE setting_key = setting_key;
