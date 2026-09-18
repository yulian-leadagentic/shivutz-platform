-- 083 · R9 §3 · widen payment_events.outcome to hold longer skip codes.
--
-- outcome was VARCHAR(16) (from 072). Existing values are ≤ 8 chars:
--   ok · declined · error
-- R9 adds:
--   skipped_no_payment_method  (25 chars)
-- which doesn't fit. Widening to VARCHAR(32) leaves headroom for future
-- skip reasons ("skipped_paused", "skipped_cancelled_mid_cycle", etc.)
-- without another migration.
--
-- Purely additive — VARCHAR width change; no data loss possible when
-- MySQL stretches column width for an already-shorter column. Reads +
-- writes keep working uninterrupted across the change.
--
-- Idempotent: read the current type and skip if already ≥32.

USE payment_db;

SET @curlen := (
  SELECT CHARACTER_MAXIMUM_LENGTH
    FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='payment_db'
     AND TABLE_NAME='payment_events'
     AND COLUMN_NAME='outcome'
);

SET @ddl := IF(
  @curlen IS NULL OR @curlen < 32,
  'ALTER TABLE payment_events
     MODIFY COLUMN outcome VARCHAR(32) NOT NULL
       COMMENT ''ok/declined/error legacy; skipped_no_payment_method new in R9''',
  'SELECT ''payment_events.outcome already >= 32''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
