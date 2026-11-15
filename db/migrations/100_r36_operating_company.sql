-- 100 · R36 · the operating company in the stored legal content and settings
--
-- Yulian, 15.11: TagidAI is operated by אג'נטיק טכנולוגיות בע"מ
-- (AGENTIC TECHNOLOGIES AND HOLDINGS LTD), ח.פ 517362620, registered
-- address רבי יוסף בוכריץ 6, ראשון לציון. It replaces "Lead Agentic ·
-- עוסק מורשה 032340283" wherever the site names its operator.
--
-- 074 seeded that name in three places: the first clause of the terms,
-- the first clause of the privacy policy, and site_settings.
--
-- Legal documents. Only the operator phrase changes, "**Lead Agentic**
-- (עוסק מורשה 032340283)"; the address that follows it in both clauses
-- is already the registered one, and no other clause is touched. The
-- change goes the way a save from /admin/legal goes (services/admin/
-- app/routes/legal.py): the body being replaced is copied to
-- legal_document_history under its version, the version is bumped, and
-- updated_by names this migration, so "what did the page say before" has
-- an answer.
--
-- Settings. company_legal_name is replaced only while it still holds
-- the seeded value; company_number and company_address are filled only
-- while they are still NULL. A value an admin typed is never
-- overwritten.
--
-- Idempotent: after the first run nothing matches any of the conditions.
-- (099 is R35's.)

USE org_db;

INSERT INTO legal_document_history (id, slug, version, body_md, replaced_by)
SELECT UUID(), slug, version, body_md, 'migration_100'
  FROM legal_documents
 WHERE LOCATE('**Lead Agentic** (עוסק מורשה 032340283)', body_md) > 0;

UPDATE legal_documents
   SET body_md    = REPLACE(body_md,
                            '**Lead Agentic** (עוסק מורשה 032340283)',
                            '**אג''נטיק טכנולוגיות בע"מ** (ח.פ 517362620)'),
       version    = version + 1,
       updated_by = 'migration_100'
 WHERE LOCATE('**Lead Agentic** (עוסק מורשה 032340283)', body_md) > 0;

UPDATE site_settings
   SET setting_val = 'אג''נטיק טכנולוגיות בע"מ'
 WHERE setting_key = 'company_legal_name' AND setting_val = 'Lead Agentic';

UPDATE site_settings
   SET setting_val = '517362620'
 WHERE setting_key = 'company_number' AND setting_val IS NULL;

UPDATE site_settings
   SET setting_val = 'רבי יוסף בוכריץ 6, ראשון לציון'
 WHERE setting_key = 'company_address' AND setting_val IS NULL;
