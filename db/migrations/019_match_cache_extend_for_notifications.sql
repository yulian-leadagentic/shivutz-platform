-- =====================================================================
-- 019_match_cache_extend_for_notifications.sql
-- =====================================================================
-- Extends job_db.match_cache for the match-found notification flow.
--
-- 1. Adds best_fill_pct + best_is_complete if missing. The Go handler in
--    services/job-match references both columns but no prior migration
--    creates them — they were ALTER'd onto local docker manually. This
--    migration finally codifies them so Railway DBs (which are missing
--    them) get the schema right.
-- 2. Adds last_notified_fill_state — drives transition-based dedupe so
--    we don't re-spam the contractor on every re-match. Values: 'none'
--    (not yet notified) or 'complete' (notified that match is_complete).
--    Re-notify only when state transitions back from 'none' → 'complete'.
--
-- Idempotent: each ADD is guarded by an INFORMATION_SCHEMA check so this
-- file is safe to apply against any state.
-- =====================================================================

USE job_db;

-- best_fill_pct
SET @ddl := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='job_db' AND TABLE_NAME='match_cache' AND COLUMN_NAME='best_fill_pct') = 0,
  'ALTER TABLE match_cache ADD COLUMN best_fill_pct FLOAT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- best_is_complete
SET @ddl := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='job_db' AND TABLE_NAME='match_cache' AND COLUMN_NAME='best_is_complete') = 0,
  'ALTER TABLE match_cache ADD COLUMN best_is_complete TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- last_notified_fill_state — dedupe for match.found notifications.
-- 'none'     = no SMS/email sent yet for the current match state
-- 'complete' = contractor was notified the match reached is_complete=true
-- Reset to 'none' when match degrades below complete; that primes a fresh
-- notification when it recovers.
SET @ddl := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='job_db' AND TABLE_NAME='match_cache' AND COLUMN_NAME='last_notified_fill_state') = 0,
  'ALTER TABLE match_cache ADD COLUMN last_notified_fill_state ENUM(''none'',''complete'') NOT NULL DEFAULT ''none''',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
