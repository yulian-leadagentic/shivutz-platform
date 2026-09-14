# U11 admin screens · fix report

Tagged `pre-u11` before changes.

## §1 · /admin/subscriptions 500 — collation mismatch (fixed)

**Diagnosis (from code, not live):** `payment_db.subscriptions` was declared
with `CHARSET=utf8mb4` and no explicit COLLATE (055:36) → MySQL 8 defaults
to `utf8mb4_0900_ai_ci`. `org_db.contractors.id` and `org_db.corporations.id`
inherit `utf8mb4_unicode_ci` from migration 001. The cross-schema JOIN on
`entity_id` at `services/admin/app/routes/subscriptions.py:59-60` raises
`Illegal mix of collations`, which surfaces as a generic 500 — the exact
Hebrew "internal_error" translation Yulian saw on screen.

**Fix:** forced `COLLATE utf8mb4_unicode_ci` on both JOIN conditions —
mirrors the workaround already in place at `services/user-org/app/routes/search.py:314`
for the same ads/corporations cross-collation join.

**Frontend follow-ups:**
- Switched raw `(e as Error).message` → `mapApiError(e)` so the U8 §3
  friendly-error mapping kicks in.
- Suppressed the "אין מנויים תואמים" empty-state when an error is set,
  so the red banner isn't paired with a misleading "DB is empty" body.

## §2 · Gov-corps registry rendering `—` for 450 rows

**Code audit:** schema (043), parser (`services/admin/app/services/gov_corp_list.py:200-241`),
insert (`insert_rows`), and endpoint (`preview_year`) all agree on the
field names (`serial_no`, `business_number`, `company_name_he`, etc.).
Frontend renders those same keys.

**What's suspicious:** the API contract carries fields the endpoint always
returns as optional (`serial_no?`, `business_number?`, …) — a shape-drift
regression would surface as silent `—`s exactly the way Yulian's screen
looks. That's what let the bug survive.

**Changes:**
- Tightened `RegistryRow` — id/source_year/imported_at now non-optional;
  data columns dropped `?` but kept `| null` for parser-legit NULLs.
- Extended `GET /admin/gov-corps-registry/{year}` to include a `stats`
  block per response — per-field fill counts, so a future silent regression
  reads as "with_business_number: 0 of 450" instead of blending in with
  the rows themselves.

**Still needed from Yulian (spec §2 acceptance can't finish from code
alone):**
1. Grab the raw API response and paste one row + the `stats` block.
2. Run `SELECT serial_no, business_number, company_name_he FROM
   gov_corporations_registry LIMIT 5;` on staging.
3. If the DB rows ARE populated but the response still shows blanks →
   look at the SELECT again (unlikely — it's `SELECT *`).
4. If the DB rows are empty → the parser was run against a PDF it
   couldn't parse; do NOT re-run the import (it wipes manual rows for
   that year).

## §3 · /admin/users expandable row (shipped)

New endpoint `GET /admin/users/{id}/details` returns three parallel
blocks:
- **entity** — name, type (contractor/corporation/service_provider),
  business_number, approval_status, joined_at, seats_used, seats_included.
- **owner** — the entity owner's full_name/phone/email (NOT the row user),
  looked up via the first active `role='owner'` membership. This is the
  "מנהל שרואה משתמש רוצה לדעת למי להתקשר" ask.
- **subscription** — tier/status/trial_ends_at/current_period_end. Uses
  the same `COLLATE utf8mb4_unicode_ci` join fixed in §1.

Frontend rewrite of `admin/users/page.tsx`:
- Row is now click-to-expand (chevron indicator).
- Lazy fetch on first open, cached — 13 users today but a 300-user table
  never eats a pre-load.
- Three-card layout inside the expanded row. Phone → `tel:`, email →
  `mailto:`. NULL subscription reads "אין מנוי פעיל" (U5 §3 rule), NOT
  as an error.
- Errors during the per-row fetch land inside the expanded row, not on
  the page-level banner.

## §4 · Origin edit → `country_not_found` (fixed)

**Diagnosis:** `services/admin/app/routes/enums.py:123-125` did
`UPDATE ... WHERE code=%s` and treated `rowcount == 0` as
"country_not_found". Same MATCHED-vs-CHANGED pymysql trap as U4 §2. An
admin who saved an origin without changing a value — e.g. clicking
"הפעל" on an already-active country, or re-saving PH with the same
English name — got a spurious 404 even though the row was right there.

**Fix pattern (same shape as U4 §2):**
```
SELECT 1 WHERE code=%s
  → no row  → 404 country_not_found
  → row     → UPDATE (rowcount 0 → 200 no-op success)
```
No `CLIENT.FOUND_ROWS` added. Applied to both `PATCH /origins/{code}`
(update_origin) and `DELETE /origins/{code}` (deactivate_origin).

**§4d audit — `is_active` filter in admin routes:**
- `enums.py list_professions`, `list_origins` — **no filter** (admin
  sees everything, good).
- `enums.py UPDATE/DELETE` — `WHERE code=%s` only, no `is_active`
  guard. So even a disabled country can be re-enabled via PATCH — the
  one-way-door concern from §4 is NOT present in current code. Yulian's
  original 404 report was caused by the rowcount trap alone.
- `org_summary.py:192` — legitimate `is_active = TRUE` on team-member
  counting. Not a bug.
- `admin/users.py DISABLE/ENABLE` — targets `users.is_active`, correct.

**Frontend:** switched `admin/origins/page.tsx` to `mapApiError` so the
already-mapped `country_not_found → "המדינה לא נמצאה"` (errors.ts:125)
renders instead of the raw code.

## Regression sweep

- Type-check clean.
- All modified Python files parse-check clean.
- No migrations touched; migration 026 untouched per guardrail.
- Origins picker on registration forms still filters by `is_active`
  (that's client-side in `useEnums().origins`, unaffected by admin route
  changes).

## Files touched

Backend:
- `services/admin/app/routes/subscriptions.py` — COLLATE fix
- `services/admin/app/routes/enums.py` — rowcount trap fix, both
  update_origin + deactivate_origin
- `services/admin/app/routes/gov_corp_list.py` — `stats` block on preview
- `services/admin/app/routes/users.py` — new `/users/{id}/details`

Frontend:
- `services/frontend/src/app/admin/subscriptions/page.tsx` — mapApiError +
  error-vs-empty exclusive
- `services/frontend/src/app/admin/origins/page.tsx` — mapApiError x4
- `services/frontend/src/app/admin/gov-corps-registry/page.tsx` — tightened
  RegistryRow
- `services/frontend/src/app/admin/users/page.tsx` — click-to-expand + 3-card
  detail block
- `services/frontend/src/lib/adminApi.ts` — `getUserDetails` client
