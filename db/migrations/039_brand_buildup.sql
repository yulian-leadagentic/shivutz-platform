-- 039: Brand sweep — old name "שיבוץ" / "פלטפורמת שיבוץ" replaced with
-- "BuildUp" in user-facing notification copy.
--
-- Migrations 011 + 017 + the original seed in 001 baked the old name
-- into notification_templates rows. We can't edit those committed
-- files (immutable history), so this migration patches the live rows
-- in-place using REPLACE() on specific brand phrases. Only phrases
-- that are unambiguously the BRAND get replaced — the generic Hebrew
-- word "שיבוץ" ("placement") is left alone where it describes the
-- action of placing workers (e.g. "פתח דשבורד שיבוץ").
--
-- Idempotent: re-running on already-patched rows is a no-op since
-- REPLACE only swaps strings that still match the old phrasing.

USE notif_db;

-- (1) The full-name phrase. "בפלטפורמת שיבוץ" → "בפורטל BuildUp".
UPDATE notification_templates
   SET subject_he = REPLACE(subject_he, 'בפלטפורמת שיבוץ', 'בפורטל BuildUp'),
       body_he    = REPLACE(body_he,    'בפלטפורמת שיבוץ', 'בפורטל BuildUp')
 WHERE subject_he LIKE '%בפלטפורמת שיבוץ%'
    OR body_he    LIKE '%בפלטפורמת שיבוץ%';

-- (2) Variant with "ה". "פלטפורמת השיבוץ" → "פורטל BuildUp".
UPDATE notification_templates
   SET subject_he = REPLACE(subject_he, 'פלטפורמת השיבוץ', 'פורטל BuildUp'),
       body_he    = REPLACE(body_he,    'פלטפורמת השיבוץ', 'פורטל BuildUp')
 WHERE subject_he LIKE '%פלטפורמת השיבוץ%'
    OR body_he    LIKE '%פלטפורמת השיבוץ%';

-- (3) Short form. "בשיבוץ" → "ב-BuildUp". Done AFTER (1) and (2) so
--     "בפלטפורמת שיבוץ" doesn't get partially-replaced first.
UPDATE notification_templates
   SET subject_he = REPLACE(subject_he, 'בשיבוץ', 'ב-BuildUp'),
       body_he    = REPLACE(body_he,    'בשיבוץ', 'ב-BuildUp')
 WHERE subject_he LIKE '%בשיבוץ%'
    OR body_he    LIKE '%בשיבוץ%';

-- (4) The brand wordmark in email header divs (e.g. <div>שיבוץ</div>).
--     Use HTML angle brackets so we don't accidentally replace the
--     generic Hebrew word "שיבוץ" inside body copy.
UPDATE notification_templates
   SET body_he = REPLACE(body_he, '>שיבוץ<', '>BuildUp<')
 WHERE body_he LIKE '%>שיבוץ<%';

-- (5) SMS prefix used in a few mixed templates that include SMS-ready
--     text. "שיבוץ —" was the brand badge at the start of SMS lines.
UPDATE notification_templates
   SET subject_he = REPLACE(subject_he, 'שיבוץ —', 'BuildUp —'),
       body_he    = REPLACE(body_he,    'שיבוץ —', 'BuildUp —')
 WHERE subject_he LIKE '%שיבוץ —%'
    OR body_he    LIKE '%שיבוץ —%';
