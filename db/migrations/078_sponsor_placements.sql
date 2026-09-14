-- 078 · U7 §5 — sponsor_ads placements + marketplace-scope seeds.
--
-- What this file does:
--
--   1. Adds a `placements` JSON column to `sponsor_ads`. Each ad can
--      now declare a list of surfaces it renders on:
--        - "search_inline"        · existing behavior (inside contractor
--                                   search results). This is also the
--                                   implicit default when placements
--                                   is NULL, so every pre-existing row
--                                   keeps its shipping behavior.
--        - "marketplace_banner"   · full-width strip above the grid on
--                                   /marketplace.
--        - "marketplace_carousel" · horizontal card row above the grid
--                                   on /marketplace.
--
--      An ad can appear in multiple placements (JSON array), so one
--      strong creative can pay for the banner AND the carousel without
--      cloning a second row.
--
--   2. Seeds 2 banners + 3 carousel items so /marketplace never
--      renders an empty sponsor section (spec F3: "no sections
--      without active ads"). All seed rows carry is_seed=TRUE — the
--      is_seed marker from migration 069 exists for exactly this
--      reason: a future prod cleanup can DELETE WHERE is_seed=TRUE
--      without risking a real advertiser row.
--
-- Rules honored:
--   - `placements IS NULL` ≡ `search_inline` (never "all"). Backend
--     `/ads/public/sponsored?placement=X` filters accordingly.
--   - JSON validated at write time; ENUM would have been stricter but
--     JSON matches the pattern the other target_* columns already use.
--   - Idempotent — the ADD COLUMN and the seed INSERTs both guard with
--     INFORMATION_SCHEMA / SELECT COUNT so a rerun is a no-op.

USE org_db;

-- ── 1. placements column ─────────────────────────────────────────
SET @ddl := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='org_db'
       AND TABLE_NAME='sponsor_ads'
       AND COLUMN_NAME='placements') = 0,
  'ALTER TABLE sponsor_ads
     ADD COLUMN placements JSON NULL COMMENT ''null=search_inline; array of "search_inline"|"marketplace_banner"|"marketplace_carousel"''
     AFTER target_regions',
  'SELECT ''sponsor_ads.placements already exists''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 2. Seed rows (F3 · no empty sponsor sections) ────────────────
-- Idempotent: only insert if we haven't already seeded U7 rows. The
-- marker is advertiser_name LIKE 'U7 seed · %' — a namespace unlikely
-- to collide with a real advertiser.
--
-- Two banners (rotate on load), three carousel cards (all shown at
-- once as a horizontal row on desktop; scroll on mobile).

SET @already := (SELECT COUNT(*) FROM sponsor_ads WHERE advertiser_name LIKE 'U7 seed · %');

-- Banner 1 — insurance broker (targets everyone)
INSERT INTO sponsor_ads
  (id, advertiser_name, headline_he, body_he, cta_label_he, cta_url,
   logo_url, brand_bg, brand_fg,
   placements, active, sort_order, is_seed)
SELECT UUID(), 'U7 seed · ביטוח BuildUp', 'ביטוח פרויקטים לקבלנים בהתאמה אישית',
       'ליווי מקצועי, תעריפים תחרותיים, אישור מהיר.',
       'קבל הצעה', 'https://buildup.co.il/insurance',
       NULL, '#0f172a', '#fefefe',
       JSON_ARRAY('marketplace_banner'), TRUE, 10, TRUE
WHERE @already = 0;

-- Banner 2 — heavy-equipment leasing
INSERT INTO sponsor_ads
  (id, advertiser_name, headline_he, body_he, cta_label_he, cta_url,
   logo_url, brand_bg, brand_fg,
   placements, active, sort_order, is_seed)
SELECT UUID(), 'U7 seed · ליסינג ציוד כבד', 'ליסינג טרקטורים ומחפרונים — ללא מקדמה',
       'ציוד חדש עד 60 חודשים, שירות ארצי, מוסך ניידי.',
       'בקש הצעה', 'https://buildup.co.il/leasing',
       NULL, '#1e293b', '#fafafa',
       JSON_ARRAY('marketplace_banner'), TRUE, 20, TRUE
WHERE @already = 0;

-- Carousel 1 — training courses
INSERT INTO sponsor_ads
  (id, advertiser_name, headline_he, body_he, chips_he,
   cta_label_he, cta_url, brand_bg, brand_fg,
   placements, active, sort_order, is_seed)
SELECT UUID(), 'U7 seed · קורסי הסמכה BuildUp',
       'הסמכות משרד העבודה', 'עגורנאי · טפסן · אחראי בטיחות',
       JSON_ARRAY('הסמכה רשמית', 'תשלום במסלול'),
       'לרישום', 'https://buildup.co.il/courses',
       '#f59e0b', '#0f172a',
       JSON_ARRAY('marketplace_carousel'), TRUE, 10, TRUE
WHERE @already = 0;

-- Carousel 2 — transport company
INSERT INTO sponsor_ads
  (id, advertiser_name, headline_he, body_he, chips_he,
   cta_label_he, cta_url, brand_bg, brand_fg,
   placements, active, sort_order, is_seed)
SELECT UUID(), 'U7 seed · הובלות אתרים 24/7',
       'הובלת עובדים לאתרים', 'שירות מ־4:00 בבוקר · צי מיניבוסים',
       JSON_ARRAY('פריסה ארצית', 'זמינות מיידית'),
       'לפרטים', 'https://buildup.co.il/transport',
       '#0891b2', '#fefefe',
       JSON_ARRAY('marketplace_carousel'), TRUE, 20, TRUE
WHERE @already = 0;

-- Carousel 3 — foreign worker legal support
INSERT INTO sponsor_ads
  (id, advertiser_name, headline_he, body_he, chips_he,
   cta_label_he, cta_url, brand_bg, brand_fg,
   placements, active, sort_order, is_seed)
SELECT UUID(), 'U7 seed · ליווי משפטי לעובדים זרים',
       'ייעוץ משפטי לתאגידים ולעובדים', 'רישוי · חוזים · שכר',
       JSON_ARRAY('מקצועי', 'תעריף חודשי'),
       'לייעוץ', 'https://buildup.co.il/legal',
       '#065f46', '#fefefe',
       JSON_ARRAY('marketplace_carousel'), TRUE, 30, TRUE
WHERE @already = 0;
