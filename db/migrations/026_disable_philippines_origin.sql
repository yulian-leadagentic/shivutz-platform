-- 026: Remove Philippines from the active origin-country list.
--
-- The product no longer accepts placements from PH. Existing rows
-- that already reference origin_country='PH' are left untouched —
-- worker records and historic searches keep their data; only the
-- pickable options going forward are affected because the worker
-- service filters `WHERE is_active = TRUE`.

USE worker_db;

UPDATE origin_countries
   SET is_active = FALSE
 WHERE code = 'PH';
