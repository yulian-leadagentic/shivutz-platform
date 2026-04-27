SET NAMES utf8mb4;

TRUNCATE TABLE profession_types;
INSERT INTO profession_types (code, name_he, name_en, category, sort_order) VALUES
  ('flooring',    'ריצוף',       'Flooring',       'construction', 1),
  ('plastering',  'טיח',         'Plastering',      'construction', 2),
  ('scaffolding', 'פיגומים',     'Scaffolding',     'construction', 3),
  ('formwork',    'תפסנות',      'Formwork',        'construction', 4),
  ('skeleton',    'שלד',         'Skeleton/Frame',  'construction', 5),
  ('painting',    'צבע',         'Painting',        'construction', 6),
  ('electricity', 'חשמל',        'Electricity',     'construction', 7),
  ('plumbing',    'אינסטלציה',   'Plumbing',        'construction', 8),
  ('general',     'כללי',        'General Labor',   'construction', 9);

TRUNCATE TABLE regions;
INSERT INTO regions (code, name_he, name_en) VALUES
  ('north',      'צפון',     'North'),
  ('center',     'מרכז',     'Center'),
  ('south',      'דרום',     'South'),
  ('jerusalem',  'ירושלים',  'Jerusalem'),
  ('national',   'כל הארץ', 'Nationwide');

TRUNCATE TABLE origin_countries;
INSERT INTO origin_countries (code, name_he, name_en) VALUES
  ('RO', 'רומניה',     'Romania'),
  ('UA', 'אוקראינה',   'Ukraine'),
  ('MD', 'מולדובה',    'Moldova'),
  ('LK', 'סרי לנקה',  'Sri Lanka'),
  ('IN', 'הודו',       'India'),
  ('PH', 'פיליפינים',  'Philippines'),
  ('TH', 'תאילנד',    'Thailand'),
  ('CN', 'סין',        'China');
