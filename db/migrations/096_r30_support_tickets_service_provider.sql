-- R30 §14a · support_tickets.entity_type ENUM missed the U7 service_provider
-- role. Migration 077 extended entity_memberships / entity_documents /
-- entity_audit / subscriptions / subscription_plans but skipped this table.
-- Result: service_provider callers hitting POST /support/tickets fail with
-- HTTP 500 (strict mode) OR silently insert an empty string (relaxed mode)
-- and get orphaned. Either way the ticket never reaches the admin queue.
--
-- Fix: MODIFY the ENUM to add 'service_provider'. All four existing values
-- retained in the same order so a legacy row's data value doesn't shift.
-- Safe to re-run — the MODIFY reads the current type first via INFORMATION_SCHEMA
-- and skips when 'service_provider' is already listed.

USE org_db;

SET @cur := (
  SELECT COLUMN_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = 'org_db'
     AND TABLE_NAME   = 'support_tickets'
     AND COLUMN_NAME  = 'entity_type'
);

SET @needs := IF(@cur IS NOT NULL AND @cur NOT LIKE '%service_provider%', 1, 0);

SET @ddl := IF(
  @needs = 1,
  'ALTER TABLE support_tickets
     MODIFY COLUMN entity_type ENUM(''contractor'',''corporation'',''service_provider'',''admin'') NULL',
  'SELECT ''support_tickets.entity_type already carries service_provider'''
);

PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
