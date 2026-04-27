-- =====================================================================
-- 018_lead_handling.sql
-- =====================================================================
--
-- Adds the "handled" axis to the leads table so admin can mark callbacks
-- + refund requests as completed without losing the history.
-- =====================================================================

USE org_db;

ALTER TABLE leads
  ADD COLUMN handled_at         DATETIME NULL,
  ADD COLUMN handled_by_user_id CHAR(36) NULL,
  ADD INDEX idx_leads_handled (handled_at);
