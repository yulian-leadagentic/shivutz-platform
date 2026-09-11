-- 071: L4 — seat pricing model for contractors (+ contractor prices)
--
-- Two things happen here:
--   (A) Schema: two new columns on subscription_plans that separate
--       "included in the base price" (included_users) from "hard cap"
--       (max_users), plus a per-extra-seat price (extra_user_price_nis).
--       Until now max_users was doing double duty as both; that made
--       "invite the 6th member of a 5-seat plan" indistinguishable
--       from "invite the 21st member of an at-most-20 plan". L4 splits
--       the two so the seat gate can return two different 402 codes
--       (seat_upgrade_required vs seat_limit) — see subscription_limits.py
--       + contractors.py / corporations.py in this same commit.
--
--   (B) Prices: contractor monthly_price_nis was NULL on all three
--       tiers — L5 cannot end-to-end test billing against a NULL
--       price. Filling them in per Yulian's brief (basic=300; the
--       two upper tiers are my proposal awaiting his sign-off, marked
--       below).
--
-- Corporation prices/limits do NOT change value; only the new columns
-- are populated with values that PRESERVE current behaviour (included
-- == max, extra=NULL = "not sold this round"). Corp seat gate returns
-- the same 402 seat_limit at the same used-count as before.

USE payment_db;

ALTER TABLE subscription_plans
  ADD COLUMN included_users       INT NULL AFTER max_users,
  ADD COLUMN extra_user_price_nis INT NULL AFTER included_users;

-- ── Contractors ─────────────────────────────────────────────────
-- Yulian brief: "5 users included in every contractor plan" +
-- "extra user = ₪80/mo". The financial model v3.2 assumed 1 included,
-- so this widens the freebie band significantly — flagged in the
-- launch report as a policy contradiction awaiting his sign-off,
-- but shipping per the brief.

UPDATE subscription_plans
   SET monthly_price_nis=300, included_users=5, extra_user_price_nis=80, max_users=10
 WHERE entity_type='contractor' AND tier='basic';

-- 450 is a proposal keeping the ladder step reasonable — לאישור Yulian
UPDATE subscription_plans
   SET monthly_price_nis=450, included_users=5, extra_user_price_nis=80, max_users=20
 WHERE entity_type='contractor' AND tier='advanced';

-- 650 is a proposal for the pro tier — לאישור Yulian
-- max_users NULL = no hard cap once the extra-seat billing is active.
UPDATE subscription_plans
   SET monthly_price_nis=650, included_users=5, extra_user_price_nis=80, max_users=NULL
 WHERE entity_type='contractor' AND tier='pro';

-- ── Corporations ────────────────────────────────────────────────
-- Existing prices (80 / 140 / 170) unchanged. included == max in every
-- tier + extra_user_price_nis=NULL preserves the current behaviour
-- (any invite above max returns 402 seat_limit, same as today). The
-- extra_user_price_nis=NULL sentinel means "no upgrade path" — used
-- by the seat-gate logic in corporations.py to keep returning
-- seat_limit instead of the new seat_upgrade_required.

UPDATE subscription_plans
   SET included_users=3, extra_user_price_nis=NULL, max_users=3
 WHERE entity_type='corporation' AND tier='basic';

UPDATE subscription_plans
   SET included_users=6, extra_user_price_nis=NULL, max_users=6
 WHERE entity_type='corporation' AND tier='advanced';

UPDATE subscription_plans
   SET included_users=12, extra_user_price_nis=NULL, max_users=12
 WHERE entity_type='corporation' AND tier='pro';
