-- =====================================================================
-- 006_threshold_documents.sql
-- · Fix grace period to 48 hours (2 days)
-- · Add threshold_requirements to corporations
-- · Add standard contract tracking to deals
-- =====================================================================

-- ── 1. Fix grace period ──────────────────────────────────────────────
USE payment_db;
UPDATE system_settings
   SET setting_value = '2',
       description   = 'מספר ימי grace period בין התחייבות לחיוב אוטומטי (48 שעות)'
 WHERE setting_key   = 'grace_period_days';

-- ── 2. Threshold requirements on corporations ────────────────────────
USE org_db;

-- JSON blob: e.g. {"minimum_contract_months":6,"housing_provided":true,"insurance_included":true,"other_notes":"..."}
ALTER TABLE corporations ADD COLUMN threshold_requirements JSON NULL;

-- ── 3. Standard contract tracking on deals ───────────────────────────
USE deal_db;

ALTER TABLE deals ADD COLUMN standard_contract_url      TEXT          NULL;
ALTER TABLE deals ADD COLUMN standard_contract_doc_name VARCHAR(300)  NULL;
