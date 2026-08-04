-- 062: pivot/v2 corp trial-end grace period (spec B3)
--
-- After trial_ends_at, corps get a 7-day grace window before their ads
-- go dark. During grace they can still see their ads on public search
-- but can't publish or edit new ones; on grace_ends_at + 1 day the
-- pause cron flips ad.active → FALSE. Renewing restores immediately.
--
-- grace_sms_step (0 → 4) latches the 4-send SMS sequence:
--   0 = no grace SMS sent yet
--   1 = day-0 send fired ("trial ended, 7 days until pause")
--   2 = day-3 send fired ("4 days left")
--   3 = day-6 send fired ("tomorrow your ads will pause")
--   4 = day-7 send fired ("ads paused — renew to restore")
--
-- Per-step latching (not a single timestamp) so we can tell which
-- notice already fired even in an out-of-order sweep. The existing
-- trial_expiry_notified_at guards the pre-expiry reminder cron,
-- which now short-circuits once trial_ends_at has passed so it
-- doesn't overlap the grace series.

USE payment_db;
ALTER TABLE subscriptions
  ADD COLUMN grace_ends_at  TIMESTAMP NULL AFTER trial_ends_at,
  ADD COLUMN grace_sms_step TINYINT   NOT NULL DEFAULT 0 AFTER trial_expiry_notified_at;

-- Backfill: every trialing sub with a trial_ends_at gets a 7-day
-- grace window derived from it. Pre-existing paying subs (status ≠
-- trialing) don't get a grace_ends_at — they're outside the grace
-- flow entirely.
UPDATE subscriptions
   SET grace_ends_at = DATE_ADD(trial_ends_at, INTERVAL 7 DAY)
 WHERE trial_ends_at IS NOT NULL
   AND grace_ends_at IS NULL;

-- ads.paused_by lets the grace-restore cron in /subscriptions/start
-- know which paused ads were auto-paused by grace hard-cap vs paused
-- by the corp themselves. Only 'grace_hard_cap' rows get restored on
-- renewal; NULL means "corp paused this — don't touch."
USE org_db;
ALTER TABLE ads
  ADD COLUMN paused_by VARCHAR(32) NULL AFTER expiry_notified_at;
