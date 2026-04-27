-- =====================================================================
-- 016_per_entity_commission.sql
-- =====================================================================
--
-- Per-entity commission rate, set by admin at approval time. Default 500₪
-- (matches the system-wide default in `commission_per_worker_nis`).
--
-- The deal-commit flow reads the CONTRACTOR's `commission_per_worker_amount`
-- as the platform commission for the J5 hold. Falls back to the
-- system_settings default if the contractor's column is NULL or 0.
--
-- This re-introduces a column that 014 dropped — the user's earlier "single
-- platform rate" requirement turned out to need a per-entity override knob.
-- =====================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
USE org_db;

ALTER TABLE contractors
  ADD COLUMN commission_per_worker_amount DECIMAL(10,2) NOT NULL DEFAULT 500.00
    COMMENT 'Platform commission charged per worker placed in deals with this contractor. Default 500. Editable by admin in the approvals screen.',
  ADD COLUMN commission_set_by_user_id    CHAR(36)    NULL,
  ADD COLUMN commission_set_at            DATETIME    NULL;

ALTER TABLE corporations
  ADD COLUMN commission_per_worker_amount DECIMAL(10,2) NOT NULL DEFAULT 500.00
    COMMENT 'Platform commission per worker — currently informational on corporations; charging side is the contractor.',
  ADD COLUMN commission_set_by_user_id    CHAR(36)    NULL,
  ADD COLUMN commission_set_at            DATETIME    NULL;
