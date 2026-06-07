-- 038: Per-user notification opt-in for corporations + contractors.
--
-- Before this migration, every event (deal.proposed, match.found, etc.)
-- fired to a single contact_phone / contact_email on the org row.
-- The new model: orgs flag up to 5 team members as "notification
-- recipients", each chooses their delivery channels independently.
--
-- Cap of 5 active recipients per (entity_type, entity_id) is enforced
-- at the API layer rather than via a trigger — the API check returns
-- a clean Hebrew error before the row is even attempted, which is
-- friendlier than catching a trigger error after the fact.
--
-- Lives in auth_db (same DB as users / entity_memberships) so the FK
-- to users + cross-entity queries stay single-instance.

CREATE TABLE IF NOT EXISTS auth_db.notification_recipients (
  id           CHAR(36)     NOT NULL,
  entity_type  ENUM('corporation', 'contractor') NOT NULL,
  entity_id    CHAR(36)     NOT NULL,
  user_id      CHAR(36)     NOT NULL,

  -- JSON array of channels this user opted into. Allowed values:
  --   'email'    — SendGrid
  --   'sms'      — Vonage SMS (live)
  --   'whatsapp' — Vonage WhatsApp (P2 — sender stub until provider live)
  -- Default per product decision: ['whatsapp','sms']. Email is opt-in.
  channels     JSON         NOT NULL,

  -- is_active vs hard delete: soft toggle so a recipient can be paused
  -- (e.g. on vacation) and re-enabled without re-picking channels.
  is_active    TINYINT(1)   NOT NULL DEFAULT 1,

  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uk_entity_user (entity_type, entity_id, user_id),
  KEY idx_entity (entity_type, entity_id, is_active),
  KEY idx_user   (user_id),

  CONSTRAINT fk_notif_user
    FOREIGN KEY (user_id) REFERENCES auth_db.users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
