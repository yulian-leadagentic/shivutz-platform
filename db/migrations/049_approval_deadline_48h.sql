-- 049: contractor approval deadline = 48 hours (was 168 / 7 days)
--
-- Product asked for a uniform 48-hour window everywhere — the
-- previous 168h default produced the "165 hours" / "7 days" copy that
-- kept appearing in the contractor's deal UI and in the SMS sent on
-- corp_committed. Drops to 48 to match `capture_delay_hours` (also
-- 48), keeping the two windows symmetrical.
--
-- This is the only system_settings row we touch — capture_delay_hours
-- and grace_period_hours stay where they are.

-- system_settings lives in payment_db (created by migration 014, which
-- inserted the original approval_deadline_hours=168 row there). Earlier
-- versions of this migration USEd deal_db by mistake and crashed the
-- runner.
USE payment_db;

UPDATE system_settings
   SET setting_value = '48',
       description   = 'Hours the contractor has to approve a corp_committed deal before it auto-expires. Aligned with capture_delay_hours so the contractor and corp windows match.'
 WHERE setting_key = 'approval_deadline_hours';
