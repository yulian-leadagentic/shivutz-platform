-- 101 · R37 Part 3 (R34 Phase 3, item 12) · the marketplace categories
-- match our list
--
-- Our list is the six chips on the home page: ביטוח · הסעות · דיור
-- לעובדים · ציוד וכלי עבודה · פיגומים · קורסים והסמכות. The table held
-- housing, equipment, services and other (and, on staging, an inactive
-- transport with no tiers). Data only; no column and no ENUM changes.
--
-- 1. housing is renamed "דיור לעובדים". It stays corporation-only.
-- 2. insurance, transport, scaffolding and courses are added (transport
--    is switched on where it already exists). Codes are permanent.
--    sort_order follows the chip order.
-- 3. D7 (Yulian, 15.11): the listings under `services` and `other` move
--    by content. Seed rows only (is_seed = 1), which is every such row
--    on staging: services/transport to transport, services/insurance to
--    insurance, and the two course listings under other to courses. A
--    row somebody actually published is not moved by a migration.
-- 4. D4 (Yulian, 15.11): a provider category with no active paid tier
--    gets one: ₪200, 30 days, 5 ads, named like today's "בסיסי". Prices
--    are data from here on, managed in /admin/marketplace. A category
--    that already has an active paid tier gets nothing added (equipment
--    on staging: בסיסי 5 ads ₪149, מקצועי 20 ads ₪399).
-- 5. services and other are switched off, never deleted, and only where
--    nothing is left on them: no published listing and no running plan.
--    On staging `other` goes off. `services` stays on: one provider
--    holds a running plan there and has no listings for it to follow.
--    That one needs Yulian's word; see the R37 report.
--
-- Idempotent: every statement is a no-op once its change is in place.

USE org_db;

UPDATE marketplace_categories
   SET name_he = 'דיור לעובדים'
 WHERE code = 'housing' AND name_he <> 'דיור לעובדים';

INSERT INTO marketplace_categories (code, name_he, name_en, icon_slug, sort_order, is_active) VALUES
  ('insurance',   'ביטוח',          'Insurance',                 'shield-check',   10, TRUE),
  ('transport',   'הסעות',          'Transport',                 'bus',            20, TRUE),
  ('scaffolding', 'פיגומים',        'Scaffolding',               'construction',   50, TRUE),
  ('courses',     'קורסים והסמכות', 'Courses and certification', 'graduation-cap', 60, TRUE)
ON DUPLICATE KEY UPDATE
  name_he    = VALUES(name_he),
  icon_slug  = COALESCE(icon_slug, VALUES(icon_slug)),
  sort_order = VALUES(sort_order),
  is_active  = TRUE;

UPDATE marketplace_categories
   SET sort_order = CASE code
         WHEN 'housing'   THEN 30
         WHEN 'equipment' THEN 40
         WHEN 'services'  THEN 90
         WHEN 'other'     THEN 100
       END
 WHERE code IN ('housing', 'equipment', 'services', 'other');

UPDATE marketplace_listings
   SET category = subcategory
 WHERE is_seed = 1
   AND category = 'services'
   AND subcategory IN ('transport', 'insurance');

UPDATE marketplace_listings
   SET category = 'courses'
 WHERE is_seed = 1
   AND category = 'other'
   AND title LIKE 'קורס%';

INSERT INTO marketplace_subscription_tiers
       (id, category_code, name_he, name_en, slot_count, duration_days, price_nis, sort_order, is_active)
SELECT UUID(), c.code, 'בסיסי', 'Basic', 5, 30, 200.00, 10, TRUE
  FROM marketplace_categories c
 WHERE c.code IN ('insurance', 'transport', 'scaffolding', 'courses', 'equipment')
   AND NOT EXISTS (
         SELECT 1 FROM marketplace_subscription_tiers t
          WHERE t.category_code = c.code AND t.is_active = TRUE AND t.price_nis > 0);

UPDATE marketplace_categories c
   SET c.is_active = FALSE
 WHERE c.code IN ('services', 'other')
   AND NOT EXISTS (
         SELECT 1 FROM marketplace_listings l
          WHERE l.category = c.code AND l.deleted_at IS NULL AND l.status = 'active')
   AND NOT EXISTS (
         SELECT 1 FROM marketplace_subscriptions s
          WHERE s.category_code = c.code AND s.status = 'active' AND s.expires_at > NOW());
