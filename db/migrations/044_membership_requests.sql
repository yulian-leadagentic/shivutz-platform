-- 044: membership_requests — inverted invite for duplicate ח.פ registrations
--
-- When a NEW user tries to register a corp/contractor whose ח.פ already
-- has an active org row in our DB, we don't just reject the registration
-- — we capture their name + phone and send the EXISTING owner an SMS
-- with a magic link to one-click approve adding the new user as a team
-- member. This row backs that flow.
--
-- Distinct from auth_db.entity_memberships in two ways:
--  1. Triggered by the requester, not the owner (so user_id is NULL on
--     this row until the owner approves and we mint a membership).
--  2. Carries the requester's typed name + phone BEFORE we know
--     whether the owner will accept — those go on the membership row
--     only at approve-time.
--
-- The flow:
--   pending  →  approved   (owner clicked approve, entity_memberships
--                            row created, requester gets SMS)
--   pending  →  rejected   (owner clicked reject, requester gets SMS)
--   pending  →  expired    (7 days elapsed; cron flips state)

USE auth_db;

CREATE TABLE IF NOT EXISTS membership_requests (
  id                  CHAR(36)     NOT NULL,
  entity_type         ENUM('contractor','corporation') NOT NULL,
  entity_id           CHAR(36)     NOT NULL,
  -- Who's asking — typed at registration, no user_id yet.
  requester_phone     VARCHAR(20)  NOT NULL,
  requester_name      VARCHAR(200) NOT NULL,
  requester_email     VARCHAR(200) NULL,
  -- Optional role hint — the requester typed 'I'm a corp admin', the
  -- owner can downgrade to viewer/admin at approve time. Default 'admin'.
  requested_role      ENUM('owner','admin','viewer') NOT NULL DEFAULT 'admin',
  -- One-click approve magic link.
  approval_token      VARCHAR(64)  NOT NULL,
  -- Lifecycle
  status              ENUM('pending','approved','rejected','expired') NOT NULL DEFAULT 'pending',
  approved_by_user_id CHAR(36)     NULL
    COMMENT 'Owner who clicked approve. NULL when still pending or rejected.',
  approved_at         DATETIME     NULL,
  rejected_at         DATETIME     NULL,
  rejection_reason    TEXT         NULL,
  -- Was an entity_memberships row created at approve-time? Cross-ref
  -- so the row remains queryable even after the user is added.
  created_membership_id CHAR(36)   NULL,
  -- Lifecycle
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at          DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_approval_token (approval_token),
  INDEX idx_entity (entity_type, entity_id),
  INDEX idx_pending_phone (requester_phone, status),
  INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
