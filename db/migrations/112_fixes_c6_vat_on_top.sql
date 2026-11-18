-- 112 · fixes list ג, item 6 · prices are before VAT, and every charge
-- keeps its split
--
-- Yulian, 18.11: every price in the system is before VAT; the charge is
-- the price plus VAT. The rate is the existing payment_db.vat_periods
-- (017), read at charge time. Each charge now records:
--   amount_nis      the total charged, VAT inside it (what a refund returns)
--   net_amount_nis  the price before VAT
--   vat_percent     the rate applied
--   vat_amount_nis  the VAT
-- on payment_events and on marketplace_charges.
--
-- payment_events.amount_nis was INT: a total with VAT can carry agorot,
-- so it becomes DECIMAL(10,2). MODIFY is idempotent.
--
-- Rows from before this migration keep NULL in the three new columns:
-- their amount was charged as it stood. All of them are test-mode rows.
--
-- Each ADD COLUMN is guarded, so a second run does nothing.

USE payment_db;

ALTER TABLE payment_events MODIFY COLUMN amount_nis DECIMAL(10,2) NULL;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_events' AND COLUMN_NAME = 'net_amount_nis');
SET @sql := IF(@col = 0,
  'ALTER TABLE payment_events ADD COLUMN net_amount_nis DECIMAL(10,2) NULL AFTER amount_nis',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_events' AND COLUMN_NAME = 'vat_percent');
SET @sql := IF(@col = 0,
  'ALTER TABLE payment_events ADD COLUMN vat_percent DECIMAL(5,2) NULL AFTER net_amount_nis',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_events' AND COLUMN_NAME = 'vat_amount_nis');
SET @sql := IF(@col = 0,
  'ALTER TABLE payment_events ADD COLUMN vat_amount_nis DECIMAL(10,2) NULL AFTER vat_percent',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'marketplace_charges' AND COLUMN_NAME = 'net_amount_nis');
SET @sql := IF(@col = 0,
  'ALTER TABLE marketplace_charges ADD COLUMN net_amount_nis DECIMAL(10,2) NULL AFTER amount_nis',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'marketplace_charges' AND COLUMN_NAME = 'vat_percent');
SET @sql := IF(@col = 0,
  'ALTER TABLE marketplace_charges ADD COLUMN vat_percent DECIMAL(5,2) NULL AFTER net_amount_nis',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'marketplace_charges' AND COLUMN_NAME = 'vat_amount_nis');
SET @sql := IF(@col = 0,
  'ALTER TABLE marketplace_charges ADD COLUMN vat_amount_nis DECIMAL(10,2) NULL AFTER vat_percent',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
