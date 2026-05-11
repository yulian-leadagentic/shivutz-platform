-- =============================================================
-- Migration 025 — Contractor-side close-the-loop deal states
-- Shivutz Platform | Wave 5
-- -------------------------------------------------------------
-- After the contractor "approves" (now relabelled "הצג פרטי
-- תאגיד" in the UI), they coordinate with the corp off-platform
-- and come back to confirm whether the deal actually closed.
--
-- Adds:
--   * 'cancelled_by_contractor' to deals.status
--   * 'contractor' to deals.cancelled_by
--
-- Idempotent via FIND_IN_SET checks on the current enum
-- definition so re-running the migration is safe.
-- =============================================================
USE deal_db;

-- ── deals.status enum ────────────────────────────────────────
SET @has_state := (
  SELECT FIND_IN_SET('cancelled_by_contractor',
    REPLACE(REPLACE(REPLACE(
      (SELECT SUBSTRING_INDEX(SUBSTRING_INDEX(COLUMN_TYPE, '(', -1), ')', 1)
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA='deal_db' AND TABLE_NAME='deals' AND COLUMN_NAME='status'),
      "'", ''), ' ', ''), '"', '')
  )
);
SET @sql := IF(@has_state = 0,
  "ALTER TABLE deals MODIFY COLUMN status ENUM(
     'proposed','corp_committed','approved','rejected','expired',
     'cancelled_by_corp','cancelled_by_contractor','closed'
   ) NOT NULL",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── deals.cancelled_by enum ──────────────────────────────────
SET @has_actor := (
  SELECT FIND_IN_SET('contractor',
    REPLACE(REPLACE(REPLACE(
      (SELECT SUBSTRING_INDEX(SUBSTRING_INDEX(COLUMN_TYPE, '(', -1), ')', 1)
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA='deal_db' AND TABLE_NAME='deals' AND COLUMN_NAME='cancelled_by'),
      "'", ''), ' ', ''), '"', '')
  )
);
SET @sql := IF(@has_actor = 0,
  "ALTER TABLE deals MODIFY COLUMN cancelled_by ENUM('corp','contractor') NULL",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
