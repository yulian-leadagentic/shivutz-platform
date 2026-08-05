-- 063: T1 — auto-publish flag on foreign_tenders
--
-- Marks tenders that skipped the admin publish-gate because the
-- publishing contractor was trusted (tier_2+ AND kablan-verified).
-- Admin still sees these rows on /admin/tenders; the flag drives a
-- filter chip so bad actors can be spot-checked post-hoc — which IS
-- the safety net that lets us auto-publish in the first place.

USE deal_db;
ALTER TABLE foreign_tenders
  ADD COLUMN auto_published TINYINT NOT NULL DEFAULT 0 AFTER status;
