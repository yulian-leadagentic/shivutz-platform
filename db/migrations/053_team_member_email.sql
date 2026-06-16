-- 053: Team-member email — invited_email on entity_memberships
--
-- Two paths to set a team member's email:
--
--   ACTIVE members  → auth_db.users.email already exists (was made nullable
--                     in 002). The PATCH endpoint UPDATEs it directly.
--                     UNIQUE constraint allows multiple NULLs but blocks
--                     duplicate non-NULL values — admin sees 409 with a
--                     readable error if they enter a colliding address.
--
--   PENDING invites → the invited team member doesn't have a users row
--                     yet, so we stage the email on the membership row.
--                     When they accept the invite (auth/login-otp creates
--                     the user), the auth flow copies invited_email into
--                     users.email if users.email is still NULL.
--
-- Without this column the team-edit modal can only set emails for
-- members who've already logged in once — leaving every pending
-- invitee's email un-set, which in turn left the email channel checkbox
-- on /contractor/users + /corporation/users permanently disabled
-- (it gates on r.email being non-empty).

USE auth_db;

SELECT IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME   = 'entity_memberships'
            AND COLUMN_NAME  = 'invited_email'),
  'SELECT ''invited_email already on entity_memberships — skipping'' AS note',
  'ALTER TABLE entity_memberships
     ADD COLUMN invited_email VARCHAR(255) NULL
       AFTER invited_phone'
) INTO @stmt;
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;
