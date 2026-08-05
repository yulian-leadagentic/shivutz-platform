-- 068: D4 — drop dead deal-lifecycle storage
--
-- Follows the code-level sunset in D4:
--   • auto_charge cron unscheduled (step 0)
--   • six dead notification handlers deleted (step 1)
--   • auto_charge.py + admin_payments.py + payment_transactions
--     callers removed (steps 3-4)
--
-- OWNERSHIP TRACE (per D4 step 4):
--   payment_transactions — used ONLY by admin_payments.py (deleted
--     in step 4) and auto_charge.py (deleted in step 3). Zero INSERTs
--     anywhere in the repo. Subscription/reveal/boost billing does
--     NOT touch this table — the live Cardcom recurring path writes
--     to `subscriptions` + `payment_methods` (tokens) only. Safe to
--     drop.
--   payment_methods — used by webhooks.py Cardcom callback for the
--     live subscription flow. NOT DROPPED.
--   subscriptions / subscription_plans / contact_reveals / ads /
--     promotions — subscription+reveal+boost storage. NOT TOUCHED.
--
-- Also cleans up the twelve orphaned notification_templates rows for
-- the six deleted deal.* handlers.

USE payment_db;

DROP TABLE IF EXISTS payment_transactions;

USE notif_db;

DELETE FROM notification_templates WHERE event_key IN (
  'deal.approved.contractor',        'deal.approved.corp',
  'deal.rejected.corp',              'deal.rejected.admin',
  'deal.expired.contractor',         'deal.expired.corp',        'deal.expired.admin',
  'deal.cancelled_by_corp.contractor', 'deal.cancelled_by_corp.admin',
  'deal.closed.contractor',          'deal.closed.corp',
  'deal.pending_admin_nudge'
);

-- ── DOWN ──────────────────────────────────────────────────────────
-- The runner is up-only. To reverse for a dev DB, restore
-- payment_transactions from migrations 005/009/010, then rerun
-- migration 015's INSERT block. Not scripted here — pre-launch, no
-- data at stake.
