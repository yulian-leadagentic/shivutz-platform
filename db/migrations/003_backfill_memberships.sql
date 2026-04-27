-- =============================================================
-- Migration 003 — Backfill entity_memberships for existing users
-- Shivutz Platform | feature/sms-otp-registration
-- -------------------------------------------------------------
-- Run AFTER migration 002.
-- Creates owner memberships for all existing users who already
-- have org_id set (the 9 users linked via seed_orgs.py).
-- Safe to re-run: ON DUPLICATE KEY UPDATE is a no-op.
-- =============================================================
USE auth_db;

INSERT INTO entity_memberships
  (membership_id, user_id, entity_type, entity_id, role, invitation_accepted_at, is_active)
SELECT
  UUID(),
  id              AS user_id,
  org_type        AS entity_type,
  org_id          AS entity_id,
  'owner'         AS role,
  created_at      AS invitation_accepted_at,   -- retroactively mark as accepted at signup
  TRUE            AS is_active
FROM users
WHERE org_id   IS NOT NULL
  AND org_type IS NOT NULL
  AND deleted_at IS NULL
ON DUPLICATE KEY UPDATE
  is_active  = TRUE,
  updated_at = NOW();

-- Verify result
SELECT
  em.entity_type,
  em.role,
  u.email,
  u.phone,
  em.entity_id,
  em.created_at
FROM entity_memberships em
JOIN users u ON u.id = em.user_id
ORDER BY em.created_at;
