-- 102 · R37 Part 3 (R34 Phase 4c, item 16) · fields per category
--
-- A provider's listing form asked every category the same questions, the
-- housing ones: city, monthly price, capacity. What a transport company,
-- an insurance agent and a course provider have to say is different, and
-- the plan of 28.08 (spec_services_housing_transport.md §ג) was to keep
-- that as data.
--
--   marketplace_categories.field_schema   what the category asks
--   marketplace_listings.attributes       the listing's answers
--   marketplace_listings.regions          the regions the listing serves
--
-- Fields the search filters on stay real columns: `regions` (a JSON
-- array of worker_db.regions codes; `region`, the single value, stays
-- for listings that have one) and `capacity`. Everything else a category
-- asks lives in `attributes`.
--
-- A schema is {"fields": [...], "require_any": [...], "price": {...}}.
-- A field is {key, label, type, options?, required?, show_if?}; type is
-- one of text, int, money, bool, select, multi, date. `price` says which
-- of the answers is the price a card shows. The server validates a
-- listing's attributes against it (services/listing_attributes.py):
-- types, required fields, option lists, and no key the schema does not
-- name.
--
-- The five schemas below are the lists Yulian gave for R34. Nothing in
-- them is marked required, because the lists do not say which are; the
-- one rule they do state is kept (equipment: at least one of the three
-- prices). The language options are Hebrew, English, Russian and the
-- main language of each origin country that is active in
-- worker_db.origin_countries today. The transport and scaffolding lists
-- are to be checked with one real provider each before they are frozen:
-- they are rows, so changing them is an UPDATE, not a deploy. Housing
-- gets no schema; its form is the corporation's and does not change.
--
-- Idempotent: columns are added only when missing, and a schema is
-- written only where the category has none, so an edit made later is
-- never overwritten.

USE org_db;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'marketplace_categories' AND COLUMN_NAME = 'field_schema');
SET @sql := IF(@col = 0, 'ALTER TABLE marketplace_categories ADD COLUMN field_schema JSON NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'marketplace_listings' AND COLUMN_NAME = 'attributes');
SET @sql := IF(@col = 0, 'ALTER TABLE marketplace_listings ADD COLUMN attributes JSON NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'marketplace_listings' AND COLUMN_NAME = 'regions');
SET @sql := IF(@col = 0, 'ALTER TABLE marketplace_listings ADD COLUMN regions JSON NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE marketplace_categories
   SET field_schema = '{"fields": [{"key": "vehicle_types", "label": "סוגי רכבים", "type": "multi", "options": ["מונית/ואן", "מיניבוס (עד 19)", "אוטובוס"]}, {"key": "max_passengers", "label": "מספר נוסעים מקסימלי", "type": "int"}, {"key": "service_type", "label": "סוג שירות", "type": "multi", "options": ["הסעה קבועה יומית", "משמרות", "חד-פעמי"]}, {"key": "nights_weekends", "label": "עבודה בלילה ובשבת", "type": "bool"}, {"key": "licensed", "label": "רישיון הסעות בתוקף", "type": "bool"}, {"key": "price_from", "label": "מחיר החל מ", "type": "money"}, {"key": "price_unit", "label": "יחידת מחיר", "type": "select", "options": ["לנסיעה", "ליום", "לחודש"]}], "price": {"amount": "price_from", "unit": "price_unit"}}'
 WHERE code = 'transport' AND field_schema IS NULL;

UPDATE marketplace_categories
   SET field_schema = '{"fields": [{"key": "insurance_types", "label": "סוגי ביטוח", "type": "multi", "options": ["ביטוח בריאות לעובדים זרים", "חבות מעבידים", "צד ג׳", "עבודות קבלניות", "ציוד מכני הנדסי"]}, {"key": "insurers", "label": "חברות ביטוח", "type": "text"}, {"key": "agent_license_no", "label": "מספר רישיון סוכן", "type": "text"}, {"key": "service_languages", "label": "שפות שירות לעובדים", "type": "multi", "options": ["עברית", "אנגלית", "רוסית", "סינית", "הינדי", "סינהלית", "תאית", "רומנית", "אוקראינית", "אוזבקית"]}], "price": {"note": "הצעת מחיר"}}'
 WHERE code = 'insurance' AND field_schema IS NULL;

UPDATE marketplace_categories
   SET field_schema = '{"fields": [{"key": "equipment_type", "label": "סוג ציוד", "type": "select", "options": ["כלי עבודה חשמליים", "גנרטורים", "מערבלי בטון", "במות הרמה", "מלגזות", "מיני מחפרון", "אחר"]}, {"key": "deal_type", "label": "השכרה / מכירה", "type": "multi", "options": ["השכרה", "מכירה"]}, {"key": "delivery", "label": "הובלה", "type": "bool"}, {"key": "delivery_fee", "label": "דמי הובלה", "type": "money", "show_if": "delivery"}, {"key": "with_operator", "label": "כולל מפעיל", "type": "bool"}, {"key": "certified_operator_required", "label": "דורש מפעיל מוסמך", "type": "bool"}, {"key": "price_day", "label": "מחיר ליום", "type": "money"}, {"key": "price_week", "label": "מחיר לשבוע", "type": "money"}, {"key": "price_month", "label": "מחיר לחודש", "type": "money"}], "require_any": [["price_day", "price_week", "price_month"]], "price": {"first_of": [["price_day", "ליום"], ["price_week", "לשבוע"], ["price_month", "לחודש"]]}}'
 WHERE code = 'equipment' AND field_schema IS NULL;

UPDATE marketplace_categories
   SET field_schema = '{"fields": [{"key": "scaffold_types", "label": "סוגי פיגומים", "type": "multi", "options": ["פיגום חזית", "פיגום נייד", "פיגום תלוי", "אלומיניום"]}, {"key": "services", "label": "שירותים", "type": "multi", "options": ["השכרה", "מכירה", "הרכבה ופירוק"]}, {"key": "licensed_installer", "label": "מתקין מורשה", "type": "bool"}, {"key": "engineer_supervision", "label": "ליווי מהנדס", "type": "bool"}, {"key": "insured", "label": "ביטוח לעבודה", "type": "bool"}, {"key": "price", "label": "מחיר", "type": "money"}, {"key": "price_unit", "label": "יחידת מחיר", "type": "select", "options": ["ליחידה לחודש", "למ״ר לחודש"]}, {"key": "delivery_fee", "label": "דמי הובלה", "type": "money"}], "price": {"amount": "price", "unit": "price_unit"}}'
 WHERE code = 'scaffolding' AND field_schema IS NULL;

UPDATE marketplace_categories
   SET field_schema = '{"fields": [{"key": "course_type", "label": "סוג הקורס", "type": "select", "options": ["עבודה בגובה", "ריענון עבודה בגובה", "מפעיל מלגזה", "עגורן", "נאמן בטיחות", "עוזר בטיחות", "אחר"]}, {"key": "certifying_body", "label": "גורם מסמיך", "type": "text"}, {"key": "duration", "label": "משך", "type": "text"}, {"key": "languages", "label": "שפות ההדרכה", "type": "multi", "options": ["עברית", "אנגלית", "רוסית", "סינית", "הינדי", "סינהלית", "תאית", "רומנית", "אוקראינית", "אוזבקית"]}, {"key": "delivery_mode", "label": "מקום", "type": "multi", "options": ["בכיתה", "באתר הלקוח"]}, {"key": "certificate_validity_months", "label": "תוקף התעודה (חודשים)", "type": "int"}, {"key": "next_date", "label": "מועד קרוב", "type": "date"}, {"key": "price", "label": "מחיר", "type": "money"}, {"key": "price_unit", "label": "יחידת מחיר", "type": "select", "options": ["למשתתף", "לקבוצה"]}], "price": {"amount": "price", "unit": "price_unit"}}'
 WHERE code = 'courses' AND field_schema IS NULL;
