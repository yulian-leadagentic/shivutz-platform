-- 033: Per QA round-3 #19 — remove origin countries that aren't
-- actively recruited (Romania for now). Soft-delete via is_active=0
-- rather than DROP so historical worker rows that still reference 'RO'
-- keep their foreign-key + the country can be re-enabled later without
-- losing data.
--
-- The admin UI for managing origins comes in a follow-up — once that
-- ships, this migration becomes the starting state.

USE worker_db;

UPDATE origin_countries SET is_active = 0 WHERE code = 'RO';
