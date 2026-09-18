-- 081 · R5 §3 · home page sponsor seeds.
--
-- Adds two new placement values by seeding rows for them:
--   - "home_banner"    · full-width strip on the home page, below the
--                        search area and above "פרסום חדש בפורטל".
--   - "home_carousel"  · horizontal row of up to 4 cards, same slot.
--
-- The `sponsor_ads.placements` column (added in 078) is JSON, so no
-- schema change is needed to accept new values — the enforcement is
-- code-side in ads.py `_ALLOWED_PLACEMENTS`. This migration only
-- seeds the rows that make the two new slots RENDER something (F3 ·
-- an empty slot renders nothing at all, so without seeds the home
-- page shows no ad section).
--
-- Idempotent: `advertiser_name LIKE 'R5 seed · %'` marker so a rerun
-- is a no-op. All seed rows carry `is_seed=TRUE` for later cleanup.

USE org_db;

SET @already := (SELECT COUNT(*) FROM sponsor_ads WHERE advertiser_name LIKE 'R5 seed · %');

-- Home banner — mortgage broker for contractors buying equipment.
INSERT INTO sponsor_ads
  (id, advertiser_name, headline_he, body_he, cta_label_he, cta_url,
   logo_url, brand_bg, brand_fg,
   placements, active, sort_order, is_seed)
SELECT UUID(), 'R5 seed · מימון פרויקטים BuildUp',
       'מסגרות אשראי מותאמות לפרויקטי בנייה',
       'ליווי בנקאי, אישור מהיר, ריביות תחרותיות.',
       'קבל הצעה', NULL,
       NULL, '#1e40af', '#fefefe',
       JSON_ARRAY('home_banner'), TRUE, 10, TRUE
WHERE @already = 0;

-- Home carousel · 1 — heavy-equipment rental (short-term)
INSERT INTO sponsor_ads
  (id, advertiser_name, headline_he, body_he, chips_he,
   cta_label_he, cta_url, brand_bg, brand_fg,
   placements, active, sort_order, is_seed)
SELECT UUID(), 'R5 seed · השכרת ציוד יומי',
       'טרקטורים ומחפרונים', 'השכרה מ־24 שעות ועד חודשים',
       JSON_ARRAY('פריסה ארצית', 'מסירה בשטח'),
       'לפרטים', NULL,
       '#7c3aed', '#fefefe',
       JSON_ARRAY('home_carousel'), TRUE, 10, TRUE
WHERE @already = 0;

-- Home carousel · 2 — safety-officer certification courses
INSERT INTO sponsor_ads
  (id, advertiser_name, headline_he, body_he, chips_he,
   cta_label_he, cta_url, brand_bg, brand_fg,
   placements, active, sort_order, is_seed)
SELECT UUID(), 'R5 seed · הסמכת ממונה בטיחות',
       'קורסי הסמכה משרד העבודה', 'מסלול מלא · פריסה ארצית',
       JSON_ARRAY('הסמכה רשמית', 'תשלום גמיש'),
       'לרישום', NULL,
       '#dc2626', '#fefefe',
       JSON_ARRAY('home_carousel'), TRUE, 20, TRUE
WHERE @already = 0;

-- Home carousel · 3 — accounting service for construction
INSERT INTO sponsor_ads
  (id, advertiser_name, headline_he, body_he, chips_he,
   cta_label_he, cta_url, brand_bg, brand_fg,
   placements, active, sort_order, is_seed)
SELECT UUID(), 'R5 seed · הנהלת חשבונות לבנייה',
       'שירות מלא לקבלנים ותאגידים', 'דיווח חודשי · מע״מ · שכר',
       JSON_ARRAY('התמחות בענף', 'מחיר קבוע'),
       'לייעוץ', NULL,
       '#047857', '#fefefe',
       JSON_ARRAY('home_carousel'), TRUE, 30, TRUE
WHERE @already = 0;
