-- 075: S1 §1.2 — is_seed marker on contractors + corporations
--
-- Anti-footgun for scripts/smoke_test.py. The smoke test signs into
-- four seeded phones and pokes at their entities (isolation, reveals,
-- history). It MUST verify that those four entities are the seed set —
-- never a real user's account — before it starts calling reveal
-- endpoints and running assertions against DB counts.
--
-- The column is a simple boolean flag flipped by
-- `scripts/mark_seed_entities.py` once per environment. The smoke
-- test refuses to run if any of the four seed phones' entities have
-- is_seed=FALSE. That guarantees we can never accidentally point the
-- smoke test at a production DB and start hammering a live user's
-- contact-reveal history.
--
-- DEFAULT FALSE — every existing row and every new registration is
-- non-seed by default. Only the marker script (or a follow-up seeder
-- run) may flip it TRUE. If prod ever imports staging data, the flag
-- carries over — that's fine, because there is no path that WRITES
-- is_seed=TRUE without an explicit operator running the marker.

USE org_db;

ALTER TABLE contractors
  ADD COLUMN is_seed BOOLEAN NOT NULL DEFAULT FALSE AFTER approval_status;

ALTER TABLE corporations
  ADD COLUMN is_seed BOOLEAN NOT NULL DEFAULT FALSE AFTER approval_status;
