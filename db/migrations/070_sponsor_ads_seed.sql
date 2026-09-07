USE org_db;

-- DEMO ONLY · לא לפרודקשן · אין אישור מהמפרסמות
--
-- H10 §4 — two placeholder sponsor ads used to demo the injection
-- layer to Yulian + investors. The wording, colours, and targeting
-- are OUR reconstructions — we did NOT receive creative or written
-- approval from Brand nor from Ayalon.
--
-- Constraints from the H10 spec:
--   * cta_url is NULL on both rows — Yulian explicitly asked for
--     non-clickable placeholders.
--   * is_seed = TRUE on both so the row can be swept by
--     WHERE is_seed = TRUE without touching future real ads.
--   * active = TRUE so /ads/public/sponsored returns them without
--     manual admin intervention on staging.
--
-- SAFE TO SHIP:
--   staging, internal demo, investor demo.
-- NOT SAFE TO SHIP:
--   production or any URL an external observer can open.

INSERT INTO sponsor_ads (
  id, advertiser_name,
  headline_he, body_he,
  chips_he, cta_label_he, cta_url,
  logo_url, brand_bg, brand_fg,
  target_professions, target_ad_types, target_regions,
  active, starts_at, ends_at, sort_order, is_seed
) VALUES (
  UUID(),
  'בראנד אספקה טכנית',
  'כלי ריצוף מקצועיים — משלוח לאתר הבנייה',
  'מכונות חיתוך קרמיקה, פלסים, מערבלי דבק וכלי מדידה.',
  JSON_ARRAY('חיתוך קרמיקה', 'פלס לייזר', 'מערבל דבק'),
  'לחנות',
  NULL,
  NULL,
  '#000000',
  '#e0a605',
  JSON_ARRAY('flooring', 'plastering', 'general'),
  JSON_ARRAY('worker'),
  NULL,
  TRUE, NULL, NULL, 10, TRUE
), (
  UUID(),
  'איילון חברה לביטוח',
  'ביטוח עובדים זרים — חובה לפני היום הראשון באתר',
  'כיסוי רפואי, תאונות עבודה וצד ג׳, בהתאם לדרישות ההיתר.',
  JSON_ARRAY('כיסוי רפואי', 'תאונות עבודה', 'צד ג׳'),
  'לפרטים',
  NULL,
  NULL,
  '#481830',
  '#ffffff',
  NULL,
  JSON_ARRAY('worker', 'housing'),
  NULL,
  TRUE, NULL, NULL, 20, TRUE
);
