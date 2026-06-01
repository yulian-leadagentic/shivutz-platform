SET NAMES utf8mb4;

TRUNCATE TABLE profession_types;
INSERT INTO profession_types (code, name_he, name_en, category, sort_order) VALUES
  ('flooring',    'ריצוף',       'Flooring',       'construction', 1),
  ('plastering',  'טיח',         'Plastering',      'construction', 2),
  -- 'scaffolding' code retained for backwards-compat; display label
  -- is now 'רתכים' per QA-R3 #12.
  ('scaffolding', 'רתכים',       'Welding',         'construction', 3),
  ('formwork',    'תפסנות',      'Formwork',        'construction', 4),
  ('skeleton',    'שלד',         'Skeleton/Frame',  'construction', 5),
  -- 'painting' code retained for backwards-compat; display label is
  -- now 'גמרים' per QA-R3 #12.
  ('painting',    'גמרים',       'Finishings',      'construction', 6),
  ('plumbing',    'אינסטלציה',   'Plumbing',        'construction', 8),
  ('general',     'כללי',        'General Labor',   'construction', 9);
-- 'electricity' deactivated per QA-R3 #12 — re-add via admin CRUD
-- when the trade is reintroduced.

TRUNCATE TABLE regions;
INSERT INTO regions (code, name_he, name_en) VALUES
  ('north',      'צפון',     'North'),
  ('center',     'מרכז',     'Center'),
  ('south',      'דרום',     'South'),
  ('jerusalem',  'ירושלים',  'Jerusalem'),
  ('national',   'כל הארץ', 'Nationwide');

TRUNCATE TABLE origin_countries;
-- Romania removed per QA round-3 #19 (not actively recruited right now).
-- Re-add via the admin country-CRUD UI when needed.
INSERT INTO origin_countries (code, name_he, name_en) VALUES
  ('UA', 'אוקראינה',   'Ukraine'),
  ('MD', 'מולדובה',    'Moldova'),
  ('LK', 'סרי לנקה',  'Sri Lanka'),
  ('IN', 'הודו',       'India'),
  ('PH', 'פיליפינים',  'Philippines'),
  ('TH', 'תאילנד',    'Thailand'),
  ('CN', 'סין',        'China');
