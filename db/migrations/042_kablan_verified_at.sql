-- 042: contractors.kablan_verified_at — proof-of-license timestamp
--
-- The existing `verified_at` column in 011_contractor_verification.sql
-- marks when a contractor reached tier_2 via ANY method (email magic-
-- link, SMS code, or admin manual_approve). It doesn't tell us whether
-- the contractor specifically proved they hold the license by typing
-- their kablan_number and having it match פנקס הקבלנים.
--
-- That kablan match is a stronger proof than the email/SMS-to-the-
-- registered-contact-channel check: the SMS/email path proves the user
-- controls the contact channel the registry has on file (which could
-- have been registered years ago by an assistant). Typing the actual
-- license number proves the contractor knows their own license id.
--
-- Distinct column so we can:
--   - Banner contractors who haven't passed kablan match yet, even if
--     they're already tier_2 via the old email/SMS path
--   - Audit which tier_2 contractors got there via the stronger proof
--   - Re-run the match cheaply on revalidation (NULL → never done)
--
-- Idempotent: ADD COLUMN IF NOT EXISTS via the same INFORMATION_SCHEMA
-- pattern used in 022_team_invite_names_drop_operator.sql.

USE org_db;

SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'org_db'
    AND TABLE_NAME   = 'contractors'
    AND COLUMN_NAME  = 'kablan_verified_at'
);

SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE contractors
     ADD COLUMN kablan_verified_at DATETIME NULL
       COMMENT ''Set when the contractor typed their kablan_number and it matched פנקס הקבלנים for their business_number. NULL = never verified via the kablan match (may still be tier_2 via the older email/SMS path).''
       AFTER verified_at',
  'SELECT ''kablan_verified_at already exists'' AS noop');

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Extend the verification_method ENUM so kablan_match is a first-class
-- value. MODIFY against an ENUM that already contains the value is a
-- no-op, so this is idempotent — MySQL just no-ops when the column
-- definition matches.
ALTER TABLE contractors
  MODIFY COLUMN verification_method
    ENUM('email','sms','manual','none','kablan_match') NULL
    COMMENT 'How tier_2 was reached. kablan_match = user typed their own kablan_number and it matched פנקס הקבלנים.';
