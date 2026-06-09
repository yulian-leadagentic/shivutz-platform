-- Fix existing payment_transactions on STG: charged_entity_id was
-- accidentally set to contractor_id instead of corporation_id.
-- Caused 403 Forbidden on every corp-side cancel / capture / void /
-- refund because those endpoints check tx.charged_entity_id == the
-- corp's org_id.
--
-- Backend bug is fixed forward (deal-service commit endpoint now
-- passes corporation_id), but this rebrands rows that already exist
-- from before the fix.
--
-- ⚠ Run on STG ONLY. Pre-launch, no live customer data.
-- ⚠ Assumes the payment_transactions live in payment_db schema and
--    the deals live in deal_db.

-- ── 1. Preview: which transactions are wrongly attributed? ────────
SELECT
  pt.id                                            AS tx_id,
  pt.deal_id,
  pt.charged_entity_type,
  pt.charged_entity_id                             AS current_entity_id,
  d.corporation_id                                 AS should_be_entity_id,
  d.contractor_id,
  pt.status,
  pt.amount,
  pt.created_at
FROM payment_db.payment_transactions pt
JOIN deal_db.deals d ON d.id = pt.deal_id
WHERE pt.charged_entity_id = d.contractor_id
  AND pt.charged_entity_id <> d.corporation_id
ORDER BY pt.created_at DESC;

-- ── 2. Apply the fix ──────────────────────────────────────────────
BEGIN;

UPDATE payment_db.payment_transactions pt
JOIN   deal_db.deals d ON d.id = pt.deal_id
SET    pt.charged_entity_type = 'corporation',
       pt.charged_entity_id   = d.corporation_id
WHERE  pt.charged_entity_id   = d.contractor_id
  AND  pt.charged_entity_id  <> d.corporation_id;

SELECT 'updated rows' AS step, ROW_COUNT() AS affected;

-- COMMIT;   -- ← uncomment to commit
-- ROLLBACK; -- ← uncomment to undo if anything looks wrong
