-- 028: Ensure +972525278625 is `role=admin` across every environment.
--
-- The original SEED_ADMIN_PHONE env-var pipeline (set on user-org,
-- creates the first admin on first boot, then the env var is
-- deleted) was supposed to make this phone admin on staging + prod.
-- In practice it didn't run cleanly on staging — Yulian's user
-- exists with role=contractor (auto-promoted from his first signup
-- as one of his contractor entities) and the admin claim never
-- reached the row. Result: the admin panel was unreachable through
-- the login flow because /auth/login/otp returns role=contractor.
--
-- This migration is idempotent + scoped to the one phone. Doesn't
-- touch users.is_active, deleted_at, or any membership rows — the
-- existing 3 entity memberships (2 contractors + 1 corporation)
-- stay intact, and the new /select-entity admin tile lets Yulian
-- pick between admin and any of his entities at login.
--
-- Safe to re-run; the WHERE clause matches at most one row, and
-- updating role='admin' to 'admin' is a no-op.

USE auth_db;

UPDATE users
   SET role = 'admin',
       updated_at = NOW()
 WHERE phone = '+972525278625'
   AND role <> 'admin'
   AND deleted_at IS NULL;
