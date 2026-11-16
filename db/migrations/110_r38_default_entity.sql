-- 110 · R38 · the entity a user's phone speaks for on WhatsApp
--
-- A WhatsApp message carries a phone number and nothing else. A user
-- with one active membership is that membership. A user with several
-- picks one (Yulian, 16.11.2026), and the chat searches with its scope.
--
-- Stored as a flag on auth_db.entity_memberships, not as a column on
-- auth_db.users, because the flag on the row makes the rule "always an
-- active, accepted membership of this user" hold by the schema itself:
--
--   of this user        the flag is on one of his own rows; there is
--                       no id that could name another user's row
--   at most one         whatsapp_default_user is the user id while the
--                       flag is on and NULL otherwise, and it is UNIQUE
--   removed             a deleted membership takes its flag with it
--                       (team_membership.delete_membership)
--   active, accepted    chk_whatsapp_default_live refuses a flagged row
--                       that is inactive or still an invitation. Code
--                       that deactivates a membership must clear the
--                       flag in the same UPDATE, or MySQL refuses it.
--
-- A column on users would need all four kept by hand in every place
-- that touches a membership, and a foreign key from it could only
-- clear itself on a delete.
--
-- Nothing is backfilled. A user with one membership needs no choice;
-- a user with several chooses on the site (users/me/whatsapp-entity).
--
-- Idempotent: each ADD is guarded.

USE auth_db;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'entity_memberships' AND COLUMN_NAME = 'is_whatsapp_default');
SET @sql := IF(@col = 0, 'ALTER TABLE entity_memberships ADD COLUMN is_whatsapp_default BOOLEAN NOT NULL DEFAULT FALSE AFTER is_deal_contact', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'entity_memberships' AND COLUMN_NAME = 'whatsapp_default_user');
SET @sql := IF(@col = 0, 'ALTER TABLE entity_memberships ADD COLUMN whatsapp_default_user CHAR(36) GENERATED ALWAYS AS (IF(is_whatsapp_default, user_id, NULL)) STORED AFTER is_whatsapp_default', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'entity_memberships' AND INDEX_NAME = 'uq_whatsapp_default_user');
SET @sql := IF(@idx = 0, 'ALTER TABLE entity_memberships ADD UNIQUE KEY uq_whatsapp_default_user (whatsapp_default_user)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @chk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'entity_memberships' AND CONSTRAINT_NAME = 'chk_whatsapp_default_live');
SET @sql := IF(@chk = 0, 'ALTER TABLE entity_memberships ADD CONSTRAINT chk_whatsapp_default_live CHECK (is_whatsapp_default = FALSE OR (is_active = TRUE AND invitation_accepted_at IS NOT NULL))', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
