-- 092: R20 §3 + R21 §3 · sponsor_ads creative_url + sponsor_carousel_limit
--
-- R20 §3 schema · three columns on sponsor_ads for advertisers who
-- come with a finished JPG (Kobi Ram, bizi — the real-money
-- categories Yulian named). When `creative_url` is set, the public
-- endpoint renders it as the ad; when NULL, the existing
-- headline/body/chips model paints instead (backwards compat for
-- migration 069+078 seed rows).
--
--   creative_url  · Cloudinary URL of the finished creative
--   creative_w    · pixel width  (for aspect-ratio, prevents CLS)
--   creative_h    · pixel height
--
-- Format enforcement is admin-side (R21 §2a upload step); the DB
-- accepts whatever numbers the admin passed. `object-fit: contain`
-- on the client guarantees the compliance disclaimer at the bottom
-- of a bizi-style ad is never cropped even if a wrong aspect leaks
-- past the admin check.
--
-- R21 §3 · site_settings.sponsor_carousel_limit (default 4). The
-- server-side ceiling (12) stays in ads.py:565 — this is the
-- admin-editable knob between 1 and 12.
--
-- All idempotent — column-add via IS/NOT EXISTS check, setting via
-- INSERT ... ON DUPLICATE KEY UPDATE key=key.

USE org_db;

-- creative_url
SET @ddl := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='org_db'
       AND TABLE_NAME='sponsor_ads'
       AND COLUMN_NAME='creative_url') = 0,
  'ALTER TABLE sponsor_ads
     ADD COLUMN creative_url VARCHAR(500) NULL AFTER logo_url',
  'SELECT ''sponsor_ads.creative_url already exists''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- creative_w
SET @ddl := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='org_db'
       AND TABLE_NAME='sponsor_ads'
       AND COLUMN_NAME='creative_w') = 0,
  'ALTER TABLE sponsor_ads
     ADD COLUMN creative_w INT NULL AFTER creative_url',
  'SELECT ''sponsor_ads.creative_w already exists''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- creative_h
SET @ddl := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='org_db'
       AND TABLE_NAME='sponsor_ads'
       AND COLUMN_NAME='creative_h') = 0,
  'ALTER TABLE sponsor_ads
     ADD COLUMN creative_h INT NULL AFTER creative_w',
  'SELECT ''sponsor_ads.creative_h already exists''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- sponsor_carousel_limit setting (R21 §3)
INSERT INTO site_settings (setting_key, setting_val, label_he) VALUES
  ('sponsor_carousel_limit', '4', 'מספר כרטיסים בקרוסלת חסויות')
ON DUPLICATE KEY UPDATE setting_key = setting_key;
