-- 040: Store the invitee's phone on pending entity_memberships rows.
--
-- Before this, the phone was used only at SMS-send time and discarded.
-- That meant /corporation/users + /contractor/users showed a blank
-- column for any pending invitation (user_id NULL → join to users
-- returns no phone). Adding invited_phone lets the same UI render
-- invites cleanly, AND lets an admin remember who they sent invites
-- to even if the SMS never bounced or the invitee never clicked.

USE auth_db;

ALTER TABLE entity_memberships
  ADD COLUMN invited_phone VARCHAR(20) NULL
    COMMENT 'Phone the inviter typed; populated only for pending invites — once accepted, the canonical phone lives on users.phone'
    AFTER invited_last_name;
