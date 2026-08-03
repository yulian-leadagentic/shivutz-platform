-- 061: pivot notification latches
--
-- Adds "we already SMS'd about this" columns so the trial-ending and
-- ad-expiring crons don't re-send the same nudge on every sweep.
-- Both nullable — populated the moment the SMS goes out; NULL means
-- "not yet notified".

USE payment_db;
ALTER TABLE subscriptions
  ADD COLUMN trial_expiry_notified_at TIMESTAMP NULL AFTER cancelled_at;

USE org_db;
ALTER TABLE ads
  ADD COLUMN expiry_notified_at TIMESTAMP NULL AFTER updated_at;
