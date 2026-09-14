-- 076: U2 §1 — is_seed marker on marketplace_listings
--
-- U1 §3b opened /marketplace to anonymous visitors via the nav +
-- footer. The catalogue was empty (§3c: 4 active categories, 0
-- rows) so the click-through landed on an empty state. U2 seeds
-- ~16 demo listings across categories so the page has content for
-- launch-week demos + first-time visitor feedback.
--
-- Every seeded row carries is_seed=TRUE. Cleanup is one statement:
--   DELETE FROM marketplace_listings WHERE is_seed = TRUE;
-- Documented in docs/ENVIRONMENTS.md. Never flip this flag manually
-- on a live listing — that is a data-integrity landmine.
--
-- The demo listings use +9720000... phone numbers (unallocated
-- Israeli range) so a real contractor calling one never rings a
-- real business. This is the same anti-footgun pattern as
-- entity_memberships in the S2 seat suite (S2_SEAT_PHONE_HEAD).
--
-- Idempotency: the seeder uses INSERT ... ON DUPLICATE KEY UPDATE
-- keyed on a synthetic (corporation_id, title) uniqueness derived
-- from the id column (no natural key here). Practical effect: the
-- seeder can be re-run and rows update in place rather than
-- duplicating.
--
-- DEFAULT FALSE — every existing row and every real corp-authored
-- listing stays is_seed=FALSE.

USE org_db;

ALTER TABLE marketplace_listings
  ADD COLUMN is_seed BOOLEAN NOT NULL DEFAULT FALSE AFTER status;

CREATE INDEX idx_ml_seed ON marketplace_listings (is_seed, status);
