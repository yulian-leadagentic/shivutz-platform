-- R29 §3-4 · demo-data patch for the new placement inventory
--
-- The R21/R22 seed rows only tag placements home_banner + home_carousel
-- (marketplace_banner + marketplace_carousel on the marketplace side).
-- After R29 §3-4 the home page swaps to home_leaderboard + home_billboard
-- and gains side_rail as a fourth surface — none of them serve any ad
-- today because no seed row asks for them, so the composite render + the
-- rail can't be observed on staging without either creating fresh rows
-- (needs admin auth) or extending an existing row's placements JSON.
--
-- This migration takes the second path, idempotently:
--   * every ACTIVE sponsor_ads row whose placements array already
--     names 'home_banner' gets 'home_leaderboard' + 'home_billboard'
--     appended (dedup via JSON_CONTAINS). Rationale: home_banner is
--     the legacy wide-strip that the frontend no longer requests;
--     the row's targeting intent (wide strip on the home page)
--     matches the new slots exactly, so the composite render will
--     surface it in-situ.
--   * one row per home_carousel gets 'side_rail' appended so the
--     R29 §4 rail has something to render at ≥1440.
--
-- SAFE to re-run: JSON_CONTAINS guards each append; a second run is
-- a no-op. SAFE to roll back: revert the migration file itself and
-- delete the two placement values from the JSON arrays manually if
-- you want the rows to stop targeting the new slots.
--
-- No new columns, no new tables, no schema changes — pure data patch
-- on org_db.sponsor_ads.

USE org_db;

-- Wide-strip demo. Every row with home_banner in its placements gets
-- home_leaderboard and home_billboard added (once). The composite
-- renderer surfaces them at both new slots because render_mode
-- computes 'composite' for wide-strip placements whenever the
-- creative doesn't fit the slot spec — which is precisely the R5
-- seed's 1037×609 situation.
UPDATE sponsor_ads
   SET placements = JSON_ARRAY_APPEND(placements, '$', 'home_leaderboard')
 WHERE active = TRUE
   AND placements IS NOT NULL
   AND JSON_CONTAINS(placements, JSON_QUOTE('home_banner'))
   AND NOT JSON_CONTAINS(placements, JSON_QUOTE('home_leaderboard'));

UPDATE sponsor_ads
   SET placements = JSON_ARRAY_APPEND(placements, '$', 'home_billboard')
 WHERE active = TRUE
   AND placements IS NOT NULL
   AND JSON_CONTAINS(placements, JSON_QUOTE('home_banner'))
   AND NOT JSON_CONTAINS(placements, JSON_QUOTE('home_billboard'));

-- Side rail demo. Pick ONE row that already runs on home_carousel and
-- give it side_rail so R29 §4 has something to render on ≥1440
-- viewports. Limit 1 by picking the earliest sort_order → deterministic
-- on both staging and prod. If no such row exists (empty carousel
-- inventory), the UPDATE affects zero rows and moves on.
UPDATE sponsor_ads
   SET placements = JSON_ARRAY_APPEND(placements, '$', 'side_rail')
 WHERE id = (
   SELECT id FROM (
     SELECT id
       FROM sponsor_ads
      WHERE active = TRUE
        AND placements IS NOT NULL
        AND JSON_CONTAINS(placements, JSON_QUOTE('home_carousel'))
        AND NOT JSON_CONTAINS(placements, JSON_QUOTE('side_rail'))
      ORDER BY sort_order ASC, created_at ASC
      LIMIT 1
   ) AS pick
 );
