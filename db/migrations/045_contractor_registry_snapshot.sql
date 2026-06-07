-- 045: persist the פנקס הקבלנים snapshot on the contractors row.
--
-- Why: registration today queries data.gov.il, uses the pinkash row to
-- decide tier + auto-approve, but only keeps a couple of denormalized
-- fields (kvutza/sivug/gov_branch). The full row is lost — admin
-- reviewing a pending contractor has to manually look up data.gov.il
-- again, and we can't compare-by-email at sign-up time without an
-- extra live call.
--
-- This migration captures the full pinkash row as JSON plus pulls out
-- the fields useful for the admin queue + verification:
--
--   gov_registry_snapshot        — raw row from פנקס הקבלנים (audit copy)
--   gov_registry_fetched_at      — when the snapshot was taken
--   registry_email               — EMAIL — used for email-match auto-approval
--   registry_phone               — MISPAR_TEL — used for phone-match auto-approval
--   registry_address             — city + street + house combined, for display
--   license_issued_at            — TAARICH_KABLAN
--   registry_kablan_mukar        — KABLAN_MUKAR ("מוכר" / "לא מוכר")
--   registry_annual_scope        — HEKEF (annual work scope in ₪)
--
-- Idempotent via the INFORMATION_SCHEMA gate (MySQL 8 lacks ADD COLUMN
-- IF NOT EXISTS). The guard checks for the JSON column; if a partial
-- run leaves some columns missing, re-running with the guard removed
-- is the easiest fix.

USE org_db;

SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'org_db'
    AND TABLE_NAME   = 'contractors'
    AND COLUMN_NAME  = 'gov_registry_snapshot'
);

SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE contractors
     ADD COLUMN gov_registry_snapshot   JSON NULL
       COMMENT ''Raw pinkash row from data.gov.il at registration / re-verification time. Preserved for admin audit and future re-checks.''
       AFTER kablan_verified_at,
     ADD COLUMN gov_registry_fetched_at DATETIME NULL
       COMMENT ''When gov_registry_snapshot was captured.''
       AFTER gov_registry_snapshot,
     ADD COLUMN registry_email          VARCHAR(255) NULL
       COMMENT ''EMAIL from פנקס הקבלנים. Used for email-match auto-approval and shown in the admin queue.''
       AFTER gov_registry_fetched_at,
     ADD COLUMN registry_phone          VARCHAR(20) NULL
       COMMENT ''MISPAR_TEL normalized to 0xxxxxxxxx (leading 0 prepended if missing). Used for phone-match auto-approval.''
       AFTER registry_email,
     ADD COLUMN registry_address        VARCHAR(500) NULL
       COMMENT ''SHEM_YISHUV + SHEM_REHOV + MISPAR_BAIT combined. Admin-display only.''
       AFTER registry_phone,
     ADD COLUMN license_issued_at       DATE NULL
       COMMENT ''TAARICH_KABLAN — when the contractor license was issued.''
       AFTER registry_address,
     ADD COLUMN registry_kablan_mukar   VARCHAR(20) NULL
       COMMENT ''KABLAN_MUKAR field — "מוכר" / "לא מוכר". Surfaced in the admin queue.''
       AFTER license_issued_at,
     ADD COLUMN registry_annual_scope   INT NULL
       COMMENT ''HEKEF — annual work scope (₪) per פנקס הקבלנים.''
       AFTER registry_kablan_mukar',
  'SELECT ''contractor registry snapshot columns already exist'' AS noop');

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
