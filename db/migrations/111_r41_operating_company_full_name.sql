-- 111 · R41 · the operator's full legal name in the stored legal content
--
-- Yulian, 17.11: the name Meta verified is אג'נטיק טכנולוגיות והחזקות בע"מ
-- (AGENTIC TECHNOLOGIES AND HOLDINGS LTD), ח.פ 517362620. Migration 100
-- wrote it without "והחזקות", from an old copy of the R36 prompt. 100
-- stays as it ran; this one finishes the name.
--
-- Same path as 100 and as a save from /admin/legal: the body being
-- replaced is copied to legal_document_history under its version, the
-- version is bumped, and updated_by names this migration. Only the
-- operator phrase changes.
--
-- Settings. company_legal_name is replaced only while it still holds the
-- value 100 wrote; a value an admin typed is never overwritten.
--
-- Idempotent: after the first run nothing matches any of the conditions.

USE org_db;

INSERT INTO legal_document_history (id, slug, version, body_md, replaced_by)
SELECT UUID(), slug, version, body_md, 'migration_111'
  FROM legal_documents
 WHERE LOCATE('**אג''נטיק טכנולוגיות בע"מ** (ח.פ 517362620)', body_md) > 0;

UPDATE legal_documents
   SET body_md    = REPLACE(body_md,
                            '**אג''נטיק טכנולוגיות בע"מ** (ח.פ 517362620)',
                            '**אג''נטיק טכנולוגיות והחזקות בע"מ** (ח.פ 517362620)'),
       version    = version + 1,
       updated_by = 'migration_111'
 WHERE LOCATE('**אג''נטיק טכנולוגיות בע"מ** (ח.פ 517362620)', body_md) > 0;

UPDATE site_settings
   SET setting_val = 'אג''נטיק טכנולוגיות והחזקות בע"מ'
 WHERE setting_key = 'company_legal_name' AND setting_val = 'אג''נטיק טכנולוגיות בע"מ';
