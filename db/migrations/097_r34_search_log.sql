-- 097 · R34 5c · search_log, the demand side of the provider dashboard
--
-- A service provider is shown "how many searches were there in your
-- category, in your regions". Until now nothing recorded that: a search
-- left a log line and no row.
--
-- One row per POST /api/search. It holds what the search turned out to
-- be ABOUT, never what was typed and never who typed it:
--   * categories  - distinct marketplace category codes among the
--                   listings the search matched, as a JSON array. Empty
--                   array when no listing matched. One row per search
--                   (not one per category) so a search that touched two
--                   of a provider's categories is still counted once.
--   * region      - the region code the query rewriter extracted, NULL
--                   when it extracted none.
--   * viewer_type - the caller's role only (contractor, corporation,
--                   service_provider, admin), NULL for an anonymous
--                   caller. No user id and no entity id for anyone. The
--                   role is kept so a provider's own test searches, and
--                   an admin's, can be left out of a demand number that
--                   is meant to describe customers.
--   * via_fallback - 1 when the listings came from the OR fallback in
--                   search.py, which matches one word of the query
--                   rather than all of it. Counted as demand today and
--                   kept apart so that choice can be revisited without
--                   losing history.
--
-- No query text column exists, on purpose.
--
-- Why nothing here touches promo_events: the two new listing events
-- (target_type 'marketplace_listing', event_type 'listing_impression'
-- and 'listing_open') fit the columns as migration 065 created them.
-- event_type is VARCHAR(32) and target_type is VARCHAR(24), neither is
-- an ENUM, and idx_target_type_time (target_type, target_id,
-- event_type, at) already serves the per-listing read. Contact reveals
-- are read from marketplace_reveals (086) and are not copied anywhere.
--
-- Re-runnable: a single CREATE TABLE IF NOT EXISTS.

USE org_db;

CREATE TABLE IF NOT EXISTS search_log (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  searched_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  categories    JSON            NOT NULL,
  region        VARCHAR(50)     NULL,
  viewer_type   VARCHAR(20)     NULL,
  via_fallback  TINYINT(1)      NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_search_log_time (searched_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
