# seed — staging-only test data

Populates staging with realistic Hebrew fixtures — contractors,
corporations, worker + housing ads, with a few boosted — so QA runs
against real content instead of empty tables.

## Guards (READ FIRST)

1. **Staging only.** `lib.mjs`'s `requireStagingGateway()` refuses to
   run against any host not in `KNOWN_STAGING_HOSTS`. Never add
   production. To point at a different staging box, edit the
   allowlist there.
2. **Seed marker = reserved phone range.** All fixtures use phones
   `+9725259XXXXX` (i.e. `0525-9XX-XXX`). The admin account
   `+972525278625` is `0525-278-625` — no collision. Reset uses
   this same range as its scope.
3. **Business number range.** Contractors: `590000000-590999999`.
   Corps: `591000000-591999999`. Real Israeli company IDs almost
   never start with 590/591; the reset SQL snippet in `reset.mjs`
   is scoped to these ranges.
4. **Idempotent.** Re-runs skip everything that already exists
   (contractor/corp 409 → "existed", ads matched by exact
   `title_he` per corp). Two consecutive `seed:staging` runs
   produce zero duplicates.
5. **Service layer only.** All entity creates go through the
   documented public API (`/api/organizations/...`), never raw SQL.
   The only SQL in this repo is the manual snippet in `reset.mjs`
   for a total wipe — kept out of the automated flow on purpose.

## Prereqs

- Node 18+ (uses built-in `fetch`).
- Staging `auth` service running with `MASTER_OTP=999999` (per
  `docs/ENVIRONMENTS.md`).
- Network access to `https://gateway-staging-3a12.up.railway.app`.

## Run

```
cd tools/seed
npm run seed:staging     # first time: creates. Second time: 0 dupes.
npm run seed:reset       # deletes seeded ads. Contractors/corps stay.
```

Env overrides (rarely needed):

```
GATEWAY_URL=https://gateway-staging-3a12.up.railway.app npm run seed:staging
MASTER_OTP=999999                                       npm run seed:staging
```

## What's seeded

- **15 contractors** (mixed regions, mixed kablan-verified state)
- **10 corporations** (mixed origins, mixed verified state)
- **50 worker ads** spread over the 10 corps (~15% boosted)
- **10 housing ads** spread over 5 corps (~20% boosted)

## What's NOT seeded (v1 scope)

- **Subscription state variants** (trial-ending, paused, expired,
  various tier grants). All seeded entities start in the default
  trial state. To manipulate: log in as an admin, then hit
  `POST /api/admin/subscriptions/{sub_id}/{extend-trial,grant,revoke}`
  per fixture's target state. A `--set-subscription-states` flag
  for `seed.mjs` is a doable follow-up.
- **Tenders** (per the CC prompt, "בלי tenders — קיים כבר").
- **Deals** (data model, not directly seedable without an active
  contractor↔corp flow — reachable via /admin only).

## What reset does + doesn't

- **Does**: DELETE every ad on every seeded corp (via
  `DELETE /api/organizations/ads/{id}`).
- **Doesn't**: delete contractor / corporation / user rows — no
  service-layer DELETE endpoint exists for them (pre-launch, orgs
  are admin-managed). Re-seed is safe anyway (409 → "existed").
- **For a total wipe**: run the SQL snippet documented in
  `reset.mjs`'s header comment against staging MySQL. Scope of
  that snippet is the seed phone range + seed business_number
  range only.
