-- 087: R14 §2 · accessibility coordinator contact — fill NULLs + inject
-- {{a11y_coordinator_block}} placeholder into section 4 of the
-- declaration so the visitor sees WHERE to write, not just WHAT.
--
-- Values Yulian confirmed on 19.09 (`052-527-8625` / `temp@gmail.com` —
-- both editable via /admin/legal → Settings tab). The email is a
-- temporary address; the prompt calls out that a mailbox nobody reads
-- makes the 60-day commitment in the declaration empty, so it should
-- be swapped before 14.10.
--
-- Section 4 gets a {{a11y_coordinator_block}} placeholder appended
-- right after the "בתוך 60 ימים" sentence. The frontend renderer
-- (legal-render.ts) substitutes the block from site_settings at
-- render time — a NULL field yields an empty placeholder, so section
-- 4 renders without half a contact.
--
-- Idempotency:
--   · site_settings UPDATE is guarded by WHERE setting_val IS NULL to
--     avoid overwriting a value an admin edited later.
--   · legal_documents UPDATE is guarded by NOT LIKE '%{{a11y_coord...'
--     — re-runs are no-ops.
--
-- Restoration note: reversing this migration on staging (rollback)
-- would leave the DB with the two setting_val's set. That is
-- deliberate: NULL after a real value is a regression, not a
-- rollback. Undo via admin panel edit if needed.

USE org_db;

-- ── Fill the two NULL rows Yulian committed to ────────────────────
UPDATE site_settings
   SET setting_val = '052-527-8625'
 WHERE setting_key = 'a11y_coordinator_phone'
   AND (setting_val IS NULL OR setting_val = '');

UPDATE site_settings
   SET setting_val = 'temp@gmail.com'
 WHERE setting_key = 'a11y_coordinator_email'
   AND (setting_val IS NULL OR setting_val = '');

-- ── Inject placeholder into section 4 of the accessibility body ──
--
-- REPLACE finds the last sentence of section 4 (which is unique in
-- the whole document — no other section talks about 60 ימים) and
-- appends `\n\n{{a11y_coordinator_block}}`. MySQL turns the escaped
-- `\n` inside a single-quoted literal into a real newline, which is
-- what markdown-it needs for a paragraph break.
--
-- version is bumped so the admin panel shows a fresh number and the
-- history table (if the doc had been edited via /admin/legal) treats
-- this as a new revision. No history row is written here because
-- history rows are the previous version's snapshot — that is the
-- admin service's job on next save.
UPDATE legal_documents
   SET body_md = REPLACE(
         body_md,
         'ובכל מקרה **בתוך 60 ימים** בהתאם לתקנות.',
         'ובכל מקרה **בתוך 60 ימים** בהתאם לתקנות.\n\n{{a11y_coordinator_block}}'
       ),
       version = version + 1,
       updated_by = 'migration_087'
 WHERE slug = 'accessibility'
   AND body_md LIKE '%ובכל מקרה **בתוך 60 ימים** בהתאם לתקנות.%'
   AND body_md NOT LIKE '%{{a11y_coordinator_block}}%';
