-- 036: QA-R3 #24 — "פניה לשירות לקוחות" inbox. Anyone signed-in
-- (contractor or corporation user, or even an admin in their own
-- context) can submit a ticket; admins see them in /admin/support and
-- mark them in_progress / resolved as they work through.
--
-- Lives in org_db because the ticket is logically attached to the
-- ORG context the user was in when they pressed the button (helps
-- the admin see "תאגיד X פנה ל…").

USE org_db;

CREATE TABLE IF NOT EXISTS support_tickets (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()),
  entity_type         ENUM('contractor','corporation','admin') NULL,
  entity_id           CHAR(36)     NULL,
  user_id             CHAR(36)     NULL,                -- the actual submitter
  subject             VARCHAR(200) NOT NULL,
  body                TEXT         NOT NULL,
  contact_phone       VARCHAR(30)  NULL,                -- optional callback no.
  status              ENUM('open','in_progress','resolved') NOT NULL DEFAULT 'open',
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  handled_at          DATETIME     NULL,
  handled_by_user_id  CHAR(36)     NULL,
  admin_notes         TEXT         NULL,                -- internal-only notes
  PRIMARY KEY (id),
  INDEX idx_st_status_created (status, created_at),
  INDEX idx_st_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
