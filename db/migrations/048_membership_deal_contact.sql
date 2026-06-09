-- 048: per-member "deal contact" opt-in
--
-- Each entity (contractor or corp) needs to designate which of its
-- members are reachable by the *other* party once a deal is approved.
-- Before this we showed a single `contact_name`/`contact_phone`/
-- `contact_email` from the entity row (whatever the founder entered
-- at registration). That's a single point of failure if the founder
-- doesn't answer the phone or leaves the company.
--
-- Rules:
--   - is_deal_contact is per-membership boolean
--   - at least one active member per entity must have the flag set
--     (enforced at the API layer; DB just stores)
--   - default for new members = false; founder gets it true via
--     this migration + at registration
--
-- Backfill: for every entity that has at least one membership,
-- flag the earliest-created active membership as the deal contact.
-- That row maps to whoever first created the entity (the founder)
-- which is the user's chosen default.

USE auth_db;

-- ── 1. Add the column (idempotent) ────────────────────────────────
SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'auth_db'
    AND TABLE_NAME   = 'entity_memberships'
    AND COLUMN_NAME  = 'is_deal_contact'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE entity_memberships
     ADD COLUMN is_deal_contact BOOLEAN NOT NULL DEFAULT FALSE
       COMMENT ''When TRUE this member is shown to the other party as a contact point on approved deals (name + phone + email exposed via /deals/{id}/contacts). At least one active membership per entity must carry the flag — enforced at the API layer, not DB.''
       AFTER is_active',
  'SELECT ''is_deal_contact already exists'' AS noop');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 2. Backfill: flag the earliest active membership per entity ───
-- Skips entities that already have at least one member flagged
-- (idempotent re-runs).
UPDATE entity_memberships em
JOIN (
  SELECT entity_type, entity_id, MIN(created_at) AS first_created
  FROM entity_memberships
  WHERE is_active = TRUE
  GROUP BY entity_type, entity_id
  HAVING SUM(is_deal_contact) = 0
) firsts ON firsts.entity_type = em.entity_type
        AND firsts.entity_id   = em.entity_id
        AND firsts.first_created = em.created_at
SET em.is_deal_contact = TRUE
WHERE em.is_active = TRUE;
