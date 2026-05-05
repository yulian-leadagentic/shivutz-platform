-- =====================================================================
-- 022_team_invite_names_drop_operator.sql
-- =====================================================================
-- Wave 2 of the post-key-user-feedback rework.
--
-- 1. entity_memberships: add invited_first_name + invited_last_name
--    so the inviter can record who they're inviting before the
--    invitee accepts. The user_id-joined `full_name` column is still
--    the source of truth once accepted; these columns are only used
--    for the pending-row display in the team-management UI.
--
-- 2. role enum: drop 'operator'. The three remaining values
--    (owner / admin / viewer) cover the cases per key-user feedback
--    ("מפעיל צופה מנהל נראה לי שיש כפילות").
--    Pre-launch state: any existing 'operator' rows are migrated to
--    'admin' (closest equivalent — operator was the prior default
--    and most rows are likely default-role anyway).
--
-- All ADDs guarded by INFORMATION_SCHEMA so the file is idempotent.
-- =====================================================================

USE auth_db;

-- ── 1. invited_first_name + invited_last_name ────────────────────────

SET @ddl := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='auth_db' AND TABLE_NAME='entity_memberships' AND COLUMN_NAME='invited_first_name') = 0,
  'ALTER TABLE entity_memberships ADD COLUMN invited_first_name VARCHAR(80) NULL AFTER job_title',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='auth_db' AND TABLE_NAME='entity_memberships' AND COLUMN_NAME='invited_last_name') = 0,
  'ALTER TABLE entity_memberships ADD COLUMN invited_last_name VARCHAR(80) NULL AFTER invited_first_name',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 2. Drop 'operator' from the role enum ────────────────────────────
-- Map any rows that still use the old default to 'admin' before the
-- enum shrink — MySQL refuses to drop an enum value that's still
-- referenced by data.

UPDATE entity_memberships
   SET role = 'admin'
 WHERE role = 'operator';

-- Re-define the enum without 'operator'. The default flips to 'admin'
-- (the new "team member with full access" tier).
SET @ddl := IF(
  (SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='auth_db' AND TABLE_NAME='entity_memberships' AND COLUMN_NAME='role') LIKE '%operator%',
  'ALTER TABLE entity_memberships MODIFY COLUMN role ENUM(''owner'',''admin'',''viewer'') NOT NULL DEFAULT ''admin''',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
