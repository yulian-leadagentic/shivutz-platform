-- 050: profession renames + new entries
--
-- Product feedback from QA-R5 R2#5:
--   - "שלד" (skeleton/frame) → "ברזלן" (rebar worker)
--   - "תפסנות" (formwork) → "תפסן" (formworker)
--   - add "חשמלאי" (electrician)
--   - add "בנאי" (builder/mason)
--
-- The existing 'electricity' row was kept as the generic trade; this
-- migration adds a dedicated 'electrician' code matching the
-- person-noun naming the new rows use ("בנאי" / "תפסן" / "ברזלן").
-- Product asked specifically for the trade person, not the trade
-- category, hence the new code.
--
-- Icon files (services/frontend/public/profession-icons/) — placeholder
-- text + matching PNGs are expected from product alongside this
-- migration. Existing icons for 'skeleton' and 'formwork' will be
-- reused for their renamed labels.

USE worker_db;

-- ── 1. Rename existing rows (label-only — codes stay so existing
--      worker_searches + workers data continues to resolve) ────────
UPDATE profession_types
   SET name_he = 'ברזלן',
       name_en = 'Rebar Worker'
 WHERE code = 'skeleton';

UPDATE profession_types
   SET name_he = 'תפסן',
       name_en = 'Formworker'
 WHERE code = 'formwork';

-- ── 2. Add new professions ──────────────────────────────────────
-- Sort orders chosen so the two new rows slot between the existing
-- general construction trades and the utility trades (electricity /
-- plumbing). Use INSERT IGNORE so re-runs are no-ops.
INSERT IGNORE INTO profession_types (code, name_he, name_en, category, sort_order) VALUES
  ('mason',       'בנאי',         'Mason / Builder',    'construction', 5),
  ('electrician', 'חשמלאי',       'Electrician',        'construction', 10);
