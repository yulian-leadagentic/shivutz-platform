-- 041: entity_memberships.user_id is nullable — pending invitations
-- (created via POST /organizations/.../users) need to insert a row
-- BEFORE the invitee accepts, and the user record only exists after
-- acceptance. The original 002_auth_otp_memberships.sql declared
-- user_id NOT NULL, but the invite endpoint has been inserting NULL
-- for years; local DBs had the constraint relaxed manually and that
-- never made it back into a migration, so staging just blew up with
-- "(1048, Column 'user_id' cannot be null)" on the first invite.
--
-- This migration aligns the schema with the code that's been running
-- everywhere except wherever the original schema is the source of truth.
-- Idempotent: MODIFY against an already-nullable column is a no-op.

USE auth_db;

ALTER TABLE entity_memberships
  MODIFY COLUMN user_id CHAR(36) NULL
  COMMENT 'NULL while invitation is pending; populated when invitee accepts the SMS/magic-link.';
