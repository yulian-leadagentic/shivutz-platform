-- 088: R10 §0 · two site_settings fixes queued by Yulian's decisions doc
--
--  1. a11y_coordinator_email  →  accessibility@tagidai.com
--     Migration 087 already wrote 'temp@gmail.com' to this row (guarded
--     on IS NULL, so it fired). That address is a real Gmail mailbox
--     owned by an unknown person. The public declaration currently
--     forwards accessibility complaints to a stranger. Per R10 §0/5,
--     replace with the tagidai.com address Yulian picked.
--
--     Cannot re-run 087 — 'IS NULL' guard would no-op now that the
--     field is populated. Instead an explicit swap that matches the
--     old value exactly, so a re-run is idempotent.
--
--     🔴 Mailbox verification is on Yulian — he needs to confirm
--     `accessibility@tagidai.com` exists and receives mail. If it
--     does not, the frontend still degrades gracefully: R14 §2
--     `buildCoordinatorMarkdown` returns '' when the email field is
--     empty AND phone is empty. With phone populated (unchanged),
--     the block still renders with the phone alone; the email line
--     just disappears. No "null" leaks.
--
--  2. launch_promo_end  =  '2026-12-31'
--     Anchor date for the launch-period free promo. Referenced by
--     the R10 §2 promo-application logic (marketplace_subscriptions
--     row created with price_paid=0 + expires_at=launch_promo_end +
--     promo_note when the field is in the future).
--     Editable via /admin/legal → Settings after this migration.
--
--     🔴 Downstream implication Yulian flagged: at 2027-01-01 EVERY
--     sub that entered the promo will hit `renewal-batch` on the
--     same day. Behavior verified against the current code —
--     RENEWAL_BATCH_LIMIT=100 with daily cron, so ~200 provider subs
--     would clear in 2 days. Cardless subs (the R9 scenario) trigger
--     `outcome=skipped_no_payment_method` + `_advance_period_no_charge`
--     — sub stays active, audit row logs the intended amount, no
--     silent suspension. See subscriptions.py:820-840.
--
-- Both edits are idempotent. Rollback is manual re-edit via admin.

USE org_db;

UPDATE site_settings
   SET setting_val = 'accessibility@tagidai.com'
 WHERE setting_key = 'a11y_coordinator_email'
   AND setting_val = 'temp@gmail.com';

INSERT INTO site_settings (setting_key, setting_val, label_he) VALUES
  ('launch_promo_end', '2026-12-31', 'תום מבצע השקה')
ON DUPLICATE KEY UPDATE setting_key = setting_key;
