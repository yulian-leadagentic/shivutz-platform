-- 058: pivot/v2 dead-table cleanup (Q-B decision)
--
-- Deletes only truly-dead tables from the old deal-lifecycle model.
-- Data in tables that survive is left alone. Safe because:
--   * pre-launch, no live data at risk
--   * frontend no longer references any of these tables
--   * services that used to write to them (deal, job-match, worker)
--     are being sunset in Wave 5
--
-- Rollback: `git revert` this migration; the tables would need to be
-- recreated by hand, but pre-launch we have no data to preserve.

USE deal_db;
DROP TABLE IF EXISTS deal_workers;
DROP TABLE IF EXISTS deal_messages;
DROP TABLE IF EXISTS deal_reports;
DROP TABLE IF EXISTS deal_events;
DROP TABLE IF EXISTS deals;
DROP TABLE IF EXISTS commissions;

USE job_db;
DROP TABLE IF EXISTS worker_search_events;
DROP TABLE IF EXISTS worker_searches;

USE worker_db;
-- The worker roster table is going away — corps embed worker info
-- (title/count/profession) into their ads now.
DROP TABLE IF EXISTS worker_documents;
DROP TABLE IF EXISTS worker_status_history;
DROP TABLE IF EXISTS workers;

-- Reset any per-deal payment transaction rows the deleted deal ids
-- referenced. Subscription rows in payment_db.subscriptions are safe.
USE payment_db;
DELETE FROM payment_transactions WHERE deal_id IS NOT NULL;
