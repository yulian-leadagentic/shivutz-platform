-- =====================================================================
-- 024_drop_projects_introduce_worker_searches.sql
-- =====================================================================
-- Wave 3 — collapse the project umbrella from the contractor's worker-
-- search flow.
--
-- Key user feedback (2026-05-06): "תהליך איתור העובדים צריך להיות
-- הרבה יותר קליל ופשוט. זה אומר שאין יותר פרוייקטים והוספה לפרוייקט
-- וכו, הופכים את זה ליותר פשוט."
--
-- Old data model:
--   job_requests (project umbrella: name, region, dates, address, status)
--     ↓ 1..N
--   job_request_line_items (one row per profession with quantity + dates)
--     ↓ 1
--   deals (FK: request_line_item_id)
--
-- New data model:
--   worker_searches (one row per profession + quantity + start_date,
--                    standalone — no project container)
--     ↓ 1
--   deals (FK: search_id)
--
-- Per `pre_launch_state` memory: we drop tables outright and rename
-- columns destructively. Existing 19 line_items + 7 deals are
-- preserved by backfilling contractor_id/region from the parent
-- request before dropping the umbrella.
--
-- Idempotency: each step is guarded with INFORMATION_SCHEMA so the
-- runner can re-apply safely. Running twice on the same DB is a no-op.
-- =====================================================================

USE job_db;

-- ── Step 1 — extend job_request_line_items with the fields it needs to
--    stand on its own. NULL allowed at first so backfill can run.

SET @has_contractor_id := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='job_db'
     AND TABLE_NAME='job_request_line_items'
     AND COLUMN_NAME='contractor_id'
);
SET @sql := IF(@has_contractor_id = 0,
  'ALTER TABLE job_request_line_items ADD COLUMN contractor_id CHAR(36) NULL AFTER id',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has_recruitment_type := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='job_db'
     AND TABLE_NAME='job_request_line_items'
     AND COLUMN_NAME='recruitment_type'
);
SET @sql := IF(@has_recruitment_type = 0,
  "ALTER TABLE job_request_line_items ADD COLUMN recruitment_type ENUM('domestic','foreign') NOT NULL DEFAULT 'domestic' AFTER contractor_id",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has_region := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='job_db'
     AND TABLE_NAME='job_request_line_items'
     AND COLUMN_NAME='region'
);
SET @sql := IF(@has_region = 0,
  'ALTER TABLE job_request_line_items ADD COLUMN region VARCHAR(50) NULL AFTER recruitment_type',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has_address := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='job_db'
     AND TABLE_NAME='job_request_line_items'
     AND COLUMN_NAME='address'
);
SET @sql := IF(@has_address = 0,
  'ALTER TABLE job_request_line_items ADD COLUMN address VARCHAR(500) NULL AFTER region',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── Step 2 — backfill from job_requests (only if request_id still exists)

SET @has_request_id := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='job_db'
     AND TABLE_NAME='job_request_line_items'
     AND COLUMN_NAME='request_id'
);
SET @sql := IF(@has_request_id = 1,
  'UPDATE job_request_line_items li
     JOIN job_requests jr ON jr.id = li.request_id
      SET li.contractor_id = jr.contractor_id,
          li.region        = jr.region,
          li.address       = jr.address
    WHERE li.contractor_id IS NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── Step 3 — tighten contractor_id to NOT NULL (after backfill)

SET @contractor_id_nullable := (
  SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='job_db'
     AND TABLE_NAME='job_request_line_items'
     AND COLUMN_NAME='contractor_id'
);
SET @sql := IF(@contractor_id_nullable = 'YES',
  'ALTER TABLE job_request_line_items MODIFY COLUMN contractor_id CHAR(36) NOT NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── Step 4 — drop request_id column

SET @sql := IF(@has_request_id = 1,
  'ALTER TABLE job_request_line_items DROP COLUMN request_id',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── Step 5 — drop the job_requests table

SET @has_job_requests := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
   WHERE TABLE_SCHEMA='job_db' AND TABLE_NAME='job_requests'
);
SET @sql := IF(@has_job_requests = 1,
  'DROP TABLE job_requests',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── Step 6 — rename job_request_line_items → worker_searches

SET @still_old := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
   WHERE TABLE_SCHEMA='job_db' AND TABLE_NAME='job_request_line_items'
);
SET @sql := IF(@still_old = 1,
  'RENAME TABLE job_request_line_items TO worker_searches',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Add an index on (contractor_id, created_at) so the dashboard query is fast.
SET @has_idx := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA='job_db'
     AND TABLE_NAME='worker_searches'
     AND INDEX_NAME='idx_ws_contractor_created'
);
SET @sql := IF(@has_idx = 0,
  'ALTER TABLE worker_searches ADD INDEX idx_ws_contractor_created (contractor_id, created_at)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── Step 7 — match_cache: rename request_id → search_id

SET @has_request_id_in_cache := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='job_db'
     AND TABLE_NAME='match_cache'
     AND COLUMN_NAME='request_id'
);
SET @sql := IF(@has_request_id_in_cache = 1,
  'ALTER TABLE match_cache CHANGE COLUMN request_id search_id CHAR(36) NOT NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── Step 8 — deal_db.deals: rename request_line_item_id → search_id

USE deal_db;

SET @has_old_fk := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='deal_db'
     AND TABLE_NAME='deals'
     AND COLUMN_NAME='request_line_item_id'
);
SET @sql := IF(@has_old_fk = 1,
  'ALTER TABLE deals CHANGE COLUMN request_line_item_id search_id CHAR(36) NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
