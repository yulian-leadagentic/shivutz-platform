-- 034: Per QA round-3 #12 — profession set adjustments.
-- Keep the internal English codes stable (deals/searches/workers
-- reference them) and rename the Hebrew display labels only.
-- חשמל is soft-disabled — historical rows that reference it stay
-- intact, and it can be re-activated later via the admin enum CRUD.

USE worker_db;

UPDATE profession_types SET name_he = 'רתכים' WHERE code = 'scaffolding';
UPDATE profession_types SET name_he = 'גמרים' WHERE code = 'painting';
UPDATE profession_types SET is_active = 0 WHERE code = 'electricity';
