-- 107 · R38 item 3a · who a service listing is for
--
-- A contractor searching "טייח לבת ים" got "חבילת ביטוח משולבת לתאגידים",
-- a listing written for corporations. A listing now says who it is for:
--
--   marketplace_listings.audience   contractors · corporations · both
--
-- VARCHAR, not ENUM, so a new value is a code change and not a schema
-- change; the allowed values live in services/user-org/app/services/
-- visibility.py (LISTING_AUDIENCES), which is also where the rule of who
-- sees what is applied to every read: search, browse, the home strips,
-- the detail page and the reveal.
--
-- Every existing row gets 'both', the default. The seed listings are
-- then set by what they say (Yulian asked for this, R38 3a):
--
--   corporations   the title says it is for corporations ("לתאגידים")
--   contractors    equipment for the building site: scaffolding, power
--                  tools, protective gear (category 'equipment')
--   both           everything else: housing, transport, courses,
--                  the other insurance listings
--
-- Advertisers' own listings (is_seed = 0) stay 'both' until their
-- advertiser chooses; the provider form now asks.
--
-- Idempotent: the column is added only when missing, and the seed
-- updates touch only rows still at the default.

USE org_db;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'marketplace_listings' AND COLUMN_NAME = 'audience');
SET @sql := IF(@col = 0,
  'ALTER TABLE marketplace_listings ADD COLUMN audience VARCHAR(16) NOT NULL DEFAULT ''both'' AFTER category',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE marketplace_listings
   SET audience = 'corporations'
 WHERE is_seed = 1 AND audience = 'both'
   AND (title LIKE '%לתאגידים%' OR title LIKE '%לתאגידי %');

UPDATE marketplace_listings
   SET audience = 'contractors'
 WHERE is_seed = 1 AND audience = 'both' AND category = 'equipment';
