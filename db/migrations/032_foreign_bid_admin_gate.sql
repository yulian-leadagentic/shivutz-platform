-- 032: Admin approval gate for foreign-import bids.
--
-- A corp's bid now lands as 'pending_admin' and is INVISIBLE to the
-- contractor until the admin approves it (status → 'submitted'). The
-- admin can also reject a bid with a free-text reason. Mirrors the
-- request-publish gate added for foreign_tenders in 031.
--
-- status is a VARCHAR (not an ENUM), so the new 'pending_admin' value
-- needs no column change — only the reason/audit columns below.

USE deal_db;

ALTER TABLE foreign_bids
  ADD COLUMN rejection_reason    TEXT      NULL,
  ADD COLUMN rejected_at         DATETIME  NULL,
  ADD COLUMN rejected_by_user_id CHAR(36)  NULL,
  ADD COLUMN approved_at         DATETIME  NULL,
  ADD COLUMN approved_by_user_id CHAR(36)  NULL;
