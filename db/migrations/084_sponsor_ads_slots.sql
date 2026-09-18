-- 084 · R6 · exclusive category slot inventory for sponsored ads.
--
-- Yulian 18.09 decided (after the shape was open since 13.08):
-- exclusive slot per category per placement per time window,
-- flat monthly price. Not rotation, not CPM. The schema below is
-- the direct translation:
--
--   sponsor_ads_slots ⟶ inventory row for one (category, placement,
--                       date range). price_nis is the flat total for
--                       the whole window. sponsor_ad_id NULL means
--                       unsold (bookable); NOT NULL means booked to
--                       that specific sponsor_ads creative.
--
-- Overlap rule (enforced by the admin API, not by a MySQL constraint
-- since MySQL lacks exclusion constraints): for any given
-- (category_code, placement) two rows may NOT have overlapping date
-- ranges. UI-side we render a calendar; server rejects a booking
-- whose starts_at < existing.ends_at AND ends_at > existing.starts_at.
--
-- category_code semantics:
--   - matches marketplace_categories.code when the slot binds to a
--     specific category (marketplace_banner filtered by category, or
--     search_inline for a specific vertical).
--   - NULL when the slot is category-agnostic (home_banner /
--     home_carousel are shown to everyone regardless of what they
--     searched for). NULL is not "any category free-for-all" — it's
--     "no category dimension applies to this placement".
--
-- Runtime resolution (added in ads.py in the same commit):
--   1. Lookup active slot for (category_code preferred over NULL,
--      placement, NOW() BETWEEN starts_at AND ends_at, sponsor_ad_id
--      NOT NULL).
--   2. If a slot wins → return its sponsor_ad_id. Exclusive: no
--      other creative for that (category, placement) shows in that
--      window, even if other sponsor_ads have that placement in
--      their `placements` JSON.
--   3. If no slot exists → fall through to the legacy RAND() pool
--      (existing sponsor_ads with placements JSON). Backwards-safe:
--      empty slot inventory = today's behavior.
--
-- Idempotent — creates table only if missing.

USE org_db;

CREATE TABLE IF NOT EXISTS sponsor_ads_slots (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()),
  category_code   VARCHAR(64)  NULL
                    COMMENT 'marketplace_categories.code, or NULL for category-agnostic placements (home_*)',
  placement       VARCHAR(32)  NOT NULL
                    COMMENT 'search_inline | marketplace_banner | marketplace_carousel | home_banner | home_carousel',
  starts_at       DATETIME     NOT NULL,
  ends_at         DATETIME     NOT NULL,
  price_nis       INT          NOT NULL
                    COMMENT 'flat price for the ENTIRE window (not per day)',
  sponsor_ad_id   CHAR(36)     NULL
                    COMMENT 'FK to sponsor_ads.id when booked; NULL when the slot is on the shelf',
  note            VARCHAR(255) NULL
                    COMMENT 'admin-facing memo (why this price, who agreed to it, etc.)',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_slot_lookup    (placement, category_code, starts_at, ends_at),
  KEY idx_slot_booked_ad (sponsor_ad_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
