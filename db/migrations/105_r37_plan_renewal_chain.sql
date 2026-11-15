-- 105 · R37 4.1.4 · a paid marketplace plan can fail to renew
--
-- A marketplace plan had no renewal: nothing read auto_renew, and
-- nothing happened to a plan at expires_at. Paid plans now renew in the
-- daily batch that renews the contractor and corporation subscriptions
-- (payment: /payments/subscriptions/internal/renewal-batch), by that
-- table's own failure rule:
--
--   a declined charge  ->  past_due, another attempt in 3 days
--   3 failed attempts  ->  expired
--
-- For that the plan row needs what the subscriptions row has:
--
--   status           gains 'past_due'
--   rebill_attempts  how many attempts have failed in this chain
--   next_attempt_at  when the batch tries again
--
-- last_renewal_attempt_at and last_renewal_error were already here
-- (migration 021) and were never written; the batch uses them now.
--
-- Nothing is backfilled: no plan has ever been charged, so none is in a
-- chain.
--
-- Idempotent: the MODIFY restates the column, the ADDs are guarded.

USE org_db;

ALTER TABLE marketplace_subscriptions
  MODIFY COLUMN status ENUM('active','past_due','expired','cancelled')
         COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active';

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'marketplace_subscriptions' AND COLUMN_NAME = 'rebill_attempts');
SET @sql := IF(@col = 0, 'ALTER TABLE marketplace_subscriptions ADD COLUMN rebill_attempts TINYINT NOT NULL DEFAULT 0 AFTER last_renewal_error', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'marketplace_subscriptions' AND COLUMN_NAME = 'next_attempt_at');
SET @sql := IF(@col = 0, 'ALTER TABLE marketplace_subscriptions ADD COLUMN next_attempt_at DATETIME NULL AFTER rebill_attempts', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
