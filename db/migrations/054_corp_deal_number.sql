-- 054: Per-corp deal number
--
-- Every deal that lands in a corp's inbox gets a per-corp sequence
-- number — '#C-127' style — so the corp's internal team + the platform
-- admin can reference one specific proposal across SMS / WhatsApp /
-- phone conversations without ambiguity. The number is scoped to a
-- single corporation: corp A's deal #127 and corp B's deal #127 are
-- distinct.
--
-- Computed at INSERT time inside the same transaction as the deal row:
--   SELECT COALESCE(MAX(corp_deal_no), 0) + 1 FROM deals
--   WHERE corporation_id = ?
--
-- That works for the (small) launch volumes. If two requests for the
-- same corp arrive simultaneously the second INSERT can collide, but
-- the (corporation_id, corp_deal_no) UNIQUE catches it and the caller
-- retries — see services/deal/app/routes/deals.py.
--
-- Idempotent INFORMATION_SCHEMA guards so the runner can re-apply
-- safely.

USE deal_db;

-- ── corp_deal_no column ────────────────────────────────────────────
SELECT IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME   = 'deals'
            AND COLUMN_NAME  = 'corp_deal_no'),
  'SELECT ''corp_deal_no already on deals — skipping column add'' AS note',
  'ALTER TABLE deals ADD COLUMN corp_deal_no INT NULL AFTER corporation_id'
) INTO @stmt;
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- ── UNIQUE (corporation_id, corp_deal_no) ─────────────────────────
-- Filters NULLs out of the constraint via MySQL's standard behaviour
-- (multiple NULLs allowed in UNIQUE), so old rows without a number
-- are safe.
SELECT IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME   = 'deals'
            AND INDEX_NAME   = 'uq_corp_deal_no'),
  'SELECT ''uq_corp_deal_no already exists — skipping index add'' AS note',
  'ALTER TABLE deals ADD UNIQUE KEY uq_corp_deal_no (corporation_id, corp_deal_no)'
) INTO @stmt;
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- ── Backfill existing rows ────────────────────────────────────────
-- Pre-launch, but staging has a handful of test deals — assign a
-- number to each so the admin views render uniformly.
-- ROW_NUMBER() works in MySQL 8 which the project targets.
UPDATE deals d
JOIN (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY corporation_id ORDER BY created_at, id) AS rn
  FROM deals
  WHERE corp_deal_no IS NULL
) numbered ON numbered.id = d.id
SET d.corp_deal_no = numbered.rn
WHERE d.corp_deal_no IS NULL;
