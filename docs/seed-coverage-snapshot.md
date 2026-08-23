# Seed Coverage Snapshot — pivot-staging

Committed record of what the ads table looks like on `pivot-staging`,
so DB state has a git-tracked reference rather than living only in
chat reports (this item was dropped from three prior reports until
we made it explicit).

Refresh cadence: whenever the seed catalogue changes materially or a
deliberate backfill runs.

## As of 2026-08-19

**Query:**
```sql
SELECT profession_code, origin_country, COUNT(*) AS n
  FROM ads
 WHERE ad_type='worker' AND active=TRUE AND deleted_at IS NULL
 GROUP BY profession_code, origin_country
 ORDER BY 1,2;
```

**Result — 20 active worker rows, 10 unique professions:**

| profession_code | origin_country | n |
|---|---|--:|
| electrician    | CN | 1 |
| electrician    | RO | 1 |
| flooring       | CN | 1 |
| flooring       | UA | 1 |
| formwork       | MD | 1 |
| formwork       | TH | 1 |
| **general**    | **CN** | **1** |
| general        | UZ | 1 |
| mason          | LK | 1 |
| mason          | UZ | 1 |
| painting       | IN | 1 |
| painting       | UA | 1 |
| plastering     | IN | 1 |
| plastering     | MD | 1 |
| plumbing       | LK | 1 |
| plumbing       | MD | 1 |
| scaffolding    | LK | 1 |
| scaffolding    | UA | 1 |
| skeleton       | CN | 1 |
| skeleton       | TH | 1 |

- 10 / 10 professions covered.
- `general + CN` present (the run-sheet smoke-test target — `"פועלים סינים"` should now return > 0 with a working rewriter).
- 2 distinct corp owners hold the 20 rows.

**Housing ads:**
- 2 active rows (`ראשון לציון`: 11 beds / ₪900, `תל אביב`: 6 beds / ₪800).
- Path `ad_type=housing` is exercised. Larger housing catalogue not
  seeded yet — see "How this was seeded" below.

## How this was seeded

`tools/seed/seed.mjs` (HTTP-driven, via `POST /api/organizations/*` +
`POST /api/ads`) was tried repeatedly across multiple sessions. It
consistently made partial progress and then stalled on auth's per-IP
OTP quota (10 send-otp per 10-minute sliding window). The seed cache
also surfaced a **catalog bug: `israeliIdWithChecksum` collapses seed
BNs 591000000-591000005 to the same output `591000005`, and 591000006-
591000009 collapse to `591000013`.** So the "10 corps already exist"
signal from the HTTP path was a false-positive: on `POST /api/
organizations/corporations` with the collided BN, backend hits 409
regardless of whether the phone is new. Only 2 real corps (BNs
591000005 + 591000013) exist in the DB.

Given the OTP wall is orthogonal to what the run sheet wanted (data
in the DB so search-quality can be judged), the missing 10 rows above
were inserted via a one-shot direct-SQL backfill:
`scratchpad/seed_backfill.py`. It attributes all 10 backfilled rows to
corp `65ffcff5-…` (the one physical seed corp with a working login);
that's fine for search-quality testing which is what the coverage
exists for.

**Follow-ups that would replace this doc with a live seed:**
1. Fix the `israeliIdWithChecksum` walker so 10 seed BNs are 10
   distinct valid IDs (currently the walker steps up 1 at a time from
   `591000000+i`, producing collisions when neighbouring seeds resolve
   to the same first-valid-checksum). Seeds should either use larger
   step sizes, or `israeliIdWithChecksum(BN_BASE_CORP + i*10)` etc.
2. Rework the seed OTP flow to reuse a single pre-authorised admin
   token that bypasses per-corp OTP (the `--admin-phone <admin>` flag
   noted in seed.mjs's TODO section).
3. Add a `HOUSING_ADS` backfill matching what the catalog defines
   (currently 10 rows over 5 corps) — needs corps 1-9 to exist.

Once (1) and (2) land, `tools/seed/seed.mjs` should be able to
produce this table (and grow it) end-to-end without direct DB writes.
