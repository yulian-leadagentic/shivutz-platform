-- 047: contractor's "view corp details" becomes a distinct action.
--
-- Until now, the contractor's only post-proposal action was "approve"
-- — which flipped status to 'approved' and revealed the corp's
-- identity in the same click. The product flow we actually want is
-- two steps:
--
--   1. View corp details      — contractor sees who proposed, can
--                                phone them, negotiate offline.
--                                Status stays 'corp_committed'.
--                                Adds `corp_revealed_at` timestamp.
--
--   2. Approve deal           — after the offline talk, the
--                                contractor formally accepts.
--                                Status flips to 'approved',
--                                grace + capture timers start.
--
-- This migration just adds the column. The endpoint + UI ship in
-- the same release. Idempotent ADD COLUMN via the INFORMATION_SCHEMA
-- guard pattern that 042 / 045 use (MySQL 8 has no native ADD
-- COLUMN IF NOT EXISTS).

USE deal_db;

SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'deal_db'
    AND TABLE_NAME   = 'deals'
    AND COLUMN_NAME  = 'corp_revealed_at'
);

SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE deals
     ADD COLUMN corp_revealed_at DATETIME NULL
       COMMENT ''Set when the contractor clicked "הצג פרטי תאגיד" — meaning the corp identity is now visible to them. Distinct from approved_at: revealing does NOT commit the deal, only unlocks contact info so the parties can talk offline before formal approval.''
       AFTER corp_committed_at',
  'SELECT ''corp_revealed_at already exists'' AS noop');

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
