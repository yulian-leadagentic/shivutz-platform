-- One-off cleanup for STG: drops duplicate worker_searches + the deals
-- they produced, before the 90-second server-side dedupe landed.
--
-- A "duplicate" here is two or more worker_searches with the same
-- (contractor_id, recruitment_type, region, profession_type, start_date)
-- created within 5 minutes of each other. The keeper is the OLDEST one
-- (smallest created_at); duplicates and any deals materialised against
-- them are soft-deleted.
--
-- ⚠ Run on STG ONLY. Pre-launch, no live customer data — destructive
-- changes are safe. Wrap in a tx + inspect SELECTs first.
--
-- Usage:
--   1. Open MySQL client connected to STG (Railway → MySQL service)
--   2. Run the SELECTs first to see what would be touched
--   3. If the count looks right, run the BEGIN ... UPDATE block
--   4. COMMIT (or ROLLBACK if it's wrong)

-- ── 1. Preview: which searches are duplicates? ─────────────────────
SELECT
  contractor_id,
  recruitment_type,
  region,
  profession_type,
  start_date,
  COUNT(*)                AS dup_count,
  GROUP_CONCAT(id)        AS search_ids,
  MIN(created_at)         AS oldest_created_at,
  MAX(created_at)         AS newest_created_at,
  TIMESTAMPDIFF(SECOND, MIN(created_at), MAX(created_at)) AS span_seconds
FROM deal_db.worker_searches
WHERE deleted_at IS NULL
GROUP BY contractor_id, recruitment_type, region, profession_type, start_date
HAVING COUNT(*) > 1
   AND TIMESTAMPDIFF(SECOND, MIN(created_at), MAX(created_at)) < 300
ORDER BY oldest_created_at DESC;

-- ── 2. Preview: which deals would also get nuked? ──────────────────
-- Anything materialised against a duplicate (not the keeper) is also
-- bogus and should go. Lists deal IDs + which corp they were proposed
-- to so the admin can decide whether to manually keep any.
SELECT
  d.id          AS deal_id,
  d.search_id,
  d.corporation_id,
  d.status,
  d.created_at,
  c.company_name_he AS corp_name
FROM deal_db.deals d
LEFT JOIN org_db.corporations c ON c.id = d.corporation_id
WHERE d.search_id IN (
  -- Subquery: the duplicate (non-keeper) search ids
  SELECT ws.id
  FROM deal_db.worker_searches ws
  INNER JOIN (
    SELECT contractor_id, recruitment_type, region, profession_type, start_date,
           MIN(created_at) AS keeper_created_at
    FROM deal_db.worker_searches
    WHERE deleted_at IS NULL
    GROUP BY contractor_id, recruitment_type, region, profession_type, start_date
    HAVING COUNT(*) > 1
  ) k ON ws.contractor_id     = k.contractor_id
      AND ws.recruitment_type  = k.recruitment_type
      AND COALESCE(ws.region,'') = COALESCE(k.region,'')
      AND ws.profession_type   = k.profession_type
      AND ws.start_date        = k.start_date
      AND ws.created_at        > k.keeper_created_at  -- skip the keeper
  WHERE ws.deleted_at IS NULL
)
AND d.deleted_at IS NULL
ORDER BY d.created_at DESC;

-- ── 3. Destructive cleanup (run only after reviewing #1 + #2) ──────
-- Soft-deletes duplicate searches + their materialised deals. The
-- keeper (oldest) row stays untouched, and its deals stay live.
BEGIN;

-- Build the duplicate-search-id list into a temp table for reuse
CREATE TEMPORARY TABLE _dup_search_ids AS
SELECT ws.id
FROM deal_db.worker_searches ws
INNER JOIN (
  SELECT contractor_id, recruitment_type, region, profession_type, start_date,
         MIN(created_at) AS keeper_created_at
  FROM deal_db.worker_searches
  WHERE deleted_at IS NULL
  GROUP BY contractor_id, recruitment_type, region, profession_type, start_date
  HAVING COUNT(*) > 1
) k ON ws.contractor_id     = k.contractor_id
    AND ws.recruitment_type  = k.recruitment_type
    AND COALESCE(ws.region,'') = COALESCE(k.region,'')
    AND ws.profession_type   = k.profession_type
    AND ws.start_date        = k.start_date
    AND ws.created_at        > k.keeper_created_at
WHERE ws.deleted_at IS NULL;

-- Soft-delete the duplicate searches
UPDATE deal_db.worker_searches
   SET deleted_at = NOW(), status = 'cancelled'
 WHERE id IN (SELECT id FROM _dup_search_ids)
   AND deleted_at IS NULL;

-- Soft-delete the deals materialised against them. Only nuke deals
-- still in pre-commit states — anything corp_committed or approved
-- has real workers locked + maybe a card hold, deal with those by
-- hand if any.
UPDATE deal_db.deals
   SET deleted_at = NOW()
 WHERE search_id IN (SELECT id FROM _dup_search_ids)
   AND status IN ('proposed', 'rejected', 'cancelled',
                  'cancelled_by_contractor', 'cancelled_by_corp', 'expired')
   AND deleted_at IS NULL;

-- Inspect — should report the row count above the "Affected" lines
SELECT 'duplicate searches soft-deleted' AS step,
       (SELECT COUNT(*) FROM _dup_search_ids) AS row_count;

DROP TEMPORARY TABLE _dup_search_ids;

-- COMMIT;   -- ← uncomment to commit
-- ROLLBACK; -- ← uncomment to undo if anything looks wrong
