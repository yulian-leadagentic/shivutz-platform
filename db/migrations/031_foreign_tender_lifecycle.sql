-- 031: Foreign-tender lifecycle + anonymity refs.
--
--   * Admin rejection with a free-text reason.
--   * Freeze / unfreeze (status='frozen' at the app layer — hidden
--     from corps, restorable).
--   * Per-corp anonymous request numbers: every corp sees a tender as
--     "בקשה מספר N" where N is sequential PER CORP, so the
--     contractor's title never leaks and two corps see different
--     numbers for the same tender. The admin screen maps each corp's
--     ref back to the real tender.
--
-- Pre-launch: safe to ALTER in place.

USE deal_db;

ALTER TABLE foreign_tenders
  ADD COLUMN rejection_reason   TEXT     NULL AFTER notes,
  ADD COLUMN rejected_at        DATETIME NULL,
  ADD COLUMN rejected_by_user_id CHAR(36) NULL,
  ADD COLUMN frozen_at          DATETIME NULL;

-- Anonymous per-corp running number. One row per (tender, corp) pair,
-- assigned the first time a corp encounters the tender. ref_no is
-- sequential within a corporation.
CREATE TABLE IF NOT EXISTS foreign_tender_corp_ref (
  id             CHAR(36)  NOT NULL PRIMARY KEY,
  tender_id      CHAR(36)  NOT NULL,
  corporation_id CHAR(36)  NOT NULL,
  ref_no         INT       NOT NULL,
  created_at     DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ftcr_pair (tender_id, corporation_id),
  KEY idx_ftcr_corp (corporation_id, ref_no),
  CONSTRAINT fk_ftcr_tender FOREIGN KEY (tender_id)
    REFERENCES foreign_tenders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
