-- 035: Per QA round-3 #20 — corp bids on foreign tenders now signal
-- whether the worker housing/accommodation is included in the quoted
-- hourly rate. Two columns so the corp can pair a yes/no with a free-
-- text caveat ("מגורים בחיפה בלבד", "כולל ארוחות בוקר", …).
--
-- Stored on foreign_bids because it's a bid-wide property, not per
-- profession line. Contractors see it as a chip next to the corp anon
-- label on each offer line so they can scan "is this all-in or do I
-- need to find housing?" at a glance.

USE deal_db;

ALTER TABLE foreign_bids
  ADD COLUMN includes_housing TINYINT(1) NULL AFTER notes,
  ADD COLUMN housing_notes    VARCHAR(500) NULL AFTER includes_housing;
