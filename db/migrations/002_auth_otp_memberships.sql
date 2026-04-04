-- =============================================================
-- Migration 002 — SMS-OTP Auth & Entity Memberships
-- Shivutz Platform | feature/sms-otp-registration
-- -------------------------------------------------------------
-- SAFE: All changes are additive. No existing columns dropped.
-- Existing email+password users are completely unaffected.
-- =============================================================
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
USE auth_db;

-- ─────────────────────────────────────────────────────────────
-- 1. Modify users table — add phone-first auth columns
-- ─────────────────────────────────────────────────────────────

-- Make email and password_hash nullable so phone-only users can exist
ALTER TABLE users
  MODIFY COLUMN email         VARCHAR(255) NULL,
  MODIFY COLUMN password_hash VARCHAR(255) NULL;

-- Add new columns for phone-first identity
ALTER TABLE users
  ADD COLUMN phone       VARCHAR(20)  NULL                               AFTER email,
  ADD COLUMN full_name   VARCHAR(100) NULL                               AFTER phone,
  ADD COLUMN auth_method ENUM('sms','email_password','google')
                         NOT NULL DEFAULT 'email_password'               AFTER full_name;

-- Unique index on phone (NULL values are exempt from unique constraint in MySQL)
ALTER TABLE users
  ADD UNIQUE KEY uq_phone (phone),
  ADD INDEX     idx_phone (phone);

-- Backfill auth_method for existing email+password users
UPDATE users SET auth_method = 'email_password' WHERE password_hash IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 2. New table: sms_otp — one-time passwords for SMS auth
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sms_otp (
  otp_id      CHAR(36)     NOT NULL DEFAULT (UUID()),
  phone       VARCHAR(20)  NOT NULL,
  code        VARCHAR(60)  NOT NULL,           -- bcrypt hash of 6-digit plain code
  purpose     ENUM('login','register','invite_accept') NOT NULL,
  expires_at  DATETIME     NOT NULL,           -- created_at + 10 minutes
  verified_at DATETIME     NULL,               -- set when successfully used
  attempts    TINYINT UNSIGNED NOT NULL DEFAULT 0, -- incremented on each wrong try; max 5
  ip_address  VARCHAR(45)  NULL,               -- for rate-limit audit
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (otp_id),
  INDEX idx_phone_purpose (phone, purpose),    -- main lookup: latest OTP for phone+purpose
  INDEX idx_expires_at    (expires_at)         -- cleanup job index
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- 3. New table: entity_memberships — user ↔ entity role binding
-- ─────────────────────────────────────────────────────────────
-- One row per (user, entity) pair. A user can be member of
-- multiple entities with different roles.
-- entity_id is a logical FK to org_db.contractors / org_db.corporations
-- (cross-DB FK not enforced by MySQL; enforced in application code)
CREATE TABLE IF NOT EXISTS entity_memberships (
  membership_id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id                CHAR(36)     NOT NULL,                  -- FK → users.id
  entity_type            ENUM('contractor','corporation') NOT NULL,
  entity_id              CHAR(36)     NOT NULL,                  -- logical FK → org_db
  role                   ENUM('owner','admin','operator','viewer') NOT NULL DEFAULT 'operator',
  job_title              VARCHAR(100) NULL,                      -- free-text display only
  invited_by             CHAR(36)     NULL,                      -- FK → users.id, nullable
  invitation_token       VARCHAR(64)  NULL,                      -- secrets.token_urlsafe(32)
  invitation_accepted_at DATETIME     NULL,
  is_active              BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (membership_id),
  UNIQUE KEY uq_user_entity   (user_id, entity_type, entity_id),  -- one role per user per entity
  UNIQUE KEY uq_invite_token  (invitation_token),                  -- tokens must be unique
  INDEX idx_entity            (entity_type, entity_id),            -- list all members of entity
  INDEX idx_user_id           (user_id),                           -- list all entities of user
  INDEX idx_invitation_token  (invitation_token),                  -- accept-invite lookup
  CONSTRAINT fk_membership_user    FOREIGN KEY (user_id)    REFERENCES users(id),
  CONSTRAINT fk_membership_inviter FOREIGN KEY (invited_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- 4. New table: entity_documents — documents belong to entity
-- ─────────────────────────────────────────────────────────────
-- Documents persist even if the user who uploaded them is removed.
CREATE TABLE IF NOT EXISTS entity_documents (
  doc_id       CHAR(36)     NOT NULL DEFAULT (UUID()),
  entity_type  ENUM('contractor','corporation') NOT NULL,
  entity_id    CHAR(36)     NOT NULL,
  doc_type     ENUM('registration_cert','contractor_license',
                    'foreign_worker_license','id_copy','other') NOT NULL,
  file_url     TEXT         NOT NULL,
  file_name    VARCHAR(255) NOT NULL,
  file_size    INT UNSIGNED NULL,               -- bytes, for display
  mime_type    VARCHAR(100) NULL,
  uploaded_by  CHAR(36)     NULL,               -- FK → users.id (nullable: admin upload)
  uploaded_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_valid     BOOLEAN      NULL,               -- NULL=pending, TRUE=approved, FALSE=rejected
  validated_by CHAR(36)     NULL,               -- FK → users.id (admin who validated)
  validated_at DATETIME     NULL,
  notes        TEXT         NULL,               -- admin rejection reason
  PRIMARY KEY (doc_id),
  INDEX idx_entity_docs  (entity_type, entity_id),
  INDEX idx_uploaded_by  (uploaded_by),
  INDEX idx_is_valid     (is_valid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- 5. New table: audit_log — team management activity trail
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  log_id      CHAR(36)     NOT NULL DEFAULT (UUID()),
  entity_type ENUM('contractor','corporation') NOT NULL,
  entity_id   CHAR(36)     NOT NULL,
  actor_id    CHAR(36)     NULL,               -- user who did the action
  action      VARCHAR(50)  NOT NULL,           -- e.g. 'member_invited', 'role_changed', 'member_removed'
  target_id   CHAR(36)     NULL,               -- affected user_id or membership_id
  metadata    JSON         NULL,               -- e.g. {old_role: 'operator', new_role: 'admin'}
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (log_id),
  INDEX idx_entity_audit (entity_type, entity_id),
  INDEX idx_actor        (actor_id),
  INDEX idx_created_at   (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
