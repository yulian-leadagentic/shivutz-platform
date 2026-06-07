-- =====================================================================
-- 023_relax_corp_id_and_origin_country.sql
-- =====================================================================
-- Two NOT NULL relaxations needed to unblock Wave 2 + Phase 2.1 flows.
--
-- 1. `marketplace_listings.corporation_id`
--    Migration 007 created it NOT NULL when V0 was corp-only.
--    Migration 021 added `advertiser_entity_*` to support contractor
--    publishers, and the create_listing route writes NULL into
--    corporation_id for contractor advertisers — but the relaxation
--    was missing, so every contractor publish 500'd with
--    "Column 'corporation_id' cannot be null".
--
-- 2. `workers.origin_country`
--    Wave 2 relaxed the corp's worker form so country is optional
--    ("לא צויין"). The frontend submits NULL when blank, the
--    Pydantic model now accepts null, but the DB column was still
--    NOT NULL — every blank-country worker create 500'd.
--
-- ALTER ... MODIFY is idempotent: re-applying the same definition
-- is a no-op.
-- =====================================================================

USE org_db;

ALTER TABLE marketplace_listings
  MODIFY COLUMN corporation_id CHAR(36) NULL;

USE worker_db;

ALTER TABLE workers
  MODIFY COLUMN origin_country CHAR(2) NULL;
