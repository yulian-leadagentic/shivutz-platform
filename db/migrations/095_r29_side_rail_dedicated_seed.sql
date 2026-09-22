-- R29 §4 · dedicated seed row for the side_rail placement.
--
-- Migration 094 extended `side_rail` onto an EXISTING row that already
-- targeted `home_carousel`. That was a mistake: the R29 §5 dedupe
-- serialises claims in reading order, and the home carousel joins the
-- queue before the side_rail (JSX/DOM mount order), so the carousel
-- claimed the shared ad and the side_rail rendered nothing.
--
-- This migration undoes that specific extension and adds a NEW
-- sponsor_ads row that ONLY targets side_rail — no overlap with any
-- other surface, so dedupe never rejects it. Row is composite-only
-- (no creative_url) so it exercises the R29 §3 composite fallback in
-- the rail; brand colours pass the WCAG 4.5:1 check the admin write
-- path enforces.

USE org_db;

-- 1) Undo migration 094's side_rail extension on the row that ALSO
-- runs on home_carousel. Uses JSON_REMOVE with JSON_SEARCH to find
-- the value's index, so it's idempotent (no-op when the value is
-- absent, e.g. re-running this migration or a fresh env).
UPDATE sponsor_ads
   SET placements = JSON_REMOVE(
     placements,
     JSON_UNQUOTE(JSON_SEARCH(placements, 'one', 'side_rail'))
   )
 WHERE placements IS NOT NULL
   AND JSON_CONTAINS(placements, JSON_QUOTE('side_rail'))
   AND JSON_CONTAINS(placements, JSON_QUOTE('home_carousel'))
   AND JSON_SEARCH(placements, 'one', 'side_rail') IS NOT NULL;

-- 2) Seed a dedicated side_rail row. Idempotent via a fixed id +
-- INSERT IGNORE, so re-runs and prod first-boots both land the same
-- state. is_seed=1 so the S1 harness knows to sweep it.
--
-- Copy uses BuildUp brand palette (#0F172A / #F78203) — a real
-- advertiser would supply their own; this exists so the R29 §4 rail
-- has something to render on staging without waiting for a live ad
-- to be booked.
INSERT IGNORE INTO sponsor_ads
  (id, advertiser_name, headline_he, body_he,
   cta_label_he, cta_url,
   brand_bg, brand_fg,
   placements, active, sort_order, is_seed,
   created_at, updated_at)
VALUES
  ('11111111-2222-3333-4444-555566667777',
   'BuildUp',
   'סלוט צד · 300×600',
   'זהו מיקום התצוגה של פרסום מסוג side rail. מיועד למחשבים בלבד ברוחב 1440 ומעלה.',
   'למידע נוסף',
   'https://buildup.co.il/',
   '#0F172A',
   '#F78203',
   JSON_ARRAY('side_rail'),
   1, 0, 1,
   NOW(), NOW());
