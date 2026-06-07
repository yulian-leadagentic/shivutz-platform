-- 037 (originally 035): Repair the double-encoded Hebrew that landed in
-- profession_types after migration 034 ran through a non-utf8mb4 mysql
-- client. The source SQL of 034 has the right bytes (0xD7 0xA8 = ר, etc.),
-- but some earlier client connection re-encoded them on the way in,
-- producing the "×¨" mojibake we see on /corporation/workers/new.
--
-- This migration is defensive — it uses HEX literals + CONVERT(... USING
-- utf8mb4) so the values are bulletproof regardless of how the migration
-- runner is configured. Idempotent: re-running it on a healthy DB just
-- rewrites the same correct bytes.
--
-- Fix (post-staging): the runner doesn't pre-select a database, so we
-- declare USE worker_db; explicitly. Without this the UPDATEs failed
-- with "No database selected" and the user-org container crashed on
-- boot trying to apply the migration.

USE worker_db;

UPDATE profession_types
   SET name_he = CONVERT(0xD7A8D7AAD79BD799D79D USING utf8mb4)  -- רתכים
 WHERE code = 'scaffolding';

UPDATE profession_types
   SET name_he = CONVERT(0xD792D79ED7A8D799D79D USING utf8mb4)  -- גמרים
 WHERE code = 'painting';
