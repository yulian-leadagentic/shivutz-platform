# U7 Phase A · service_provider audit report

Decision table for every `("contractor","corporation")` branch reached during
the sweep. Each row is either **IN** (extended to include `service_provider`)
or **OUT** (deliberately excluded). No branch is left implicit.

## §1 · Decision table

| # | File · line | Current branch | Decision | Reason |
|---|---|---|---|---|
| 1 | `services/user-org/app/routes/ads.py:1191` (comment) | `viewer_type: 'contractor' \| 'corporation'` | **OUT** | Provider gets zero ads via `viewer_scope_wheres` returning `1=0` (visibility.py:76-83). No ad-viewer path opens up. |
| 2 | `services/user-org/app/routes/ads.py` contact_reveal | added guard | **OUT** (rejected at gate) | `require_no_service_provider(x_entity_type)` raises 403 `entity_type_forbidden`. Provider is a seller, not a buyer. |
| 3 | `services/user-org/app/routes/marketplace.py:122` `mine=true` filter | `entity_type in ("contractor", "corporation")` | **IN** | Provider owns marketplace listings on the same table; needs the same `mine=true` filter. Fixed. |
| 4 | `services/user-org/app/routes/marketplace.py:265` POST /listings | whitelist | **IN** | Provider publishes into `marketplace_listings` with `advertiser_entity_type='service_provider'`. Fixed. |
| 5 | `services/user-org/app/routes/marketplace.py:512-513` POST /leads | `body.org_type not in ("contractor","corporation")` | **OUT** | Public lead-capture is a landing-page funnel for contractor/corp signups only. Providers self-register on `/register/provider`. |
| 6 | `services/user-org/app/routes/marketplace_subscriptions.py:42` | whitelist | **IN** | Provider gets a free `marketplace_subscriptions` row (Phase B). Fixed. |
| 7 | `services/user-org/app/routes/marketplace_uploads.py:68` | Cloudinary signature whitelist | **IN** | Provider needs signed uploads for listing images (same table). Fixed. |
| 8 | `services/user-org/app/routes/support.py:41-42` | ticket filing | **IN** | Provider must be able to file support tickets. Fixed. |
| 9 | `services/user-org/app/services/visibility.py:71-84` `viewer_scope_wheres` | corp branch | **IN (explicit deny)** | Provider gets `["1=0"], []` — zero rows across all five ad-reading endpoints. |
| 10 | `services/user-org/app/services/entity_access.py:32` comment | `'corporation' \| 'contractor'` | **NEEDS EXTEND (Phase B)** | Team-membership helper. Provider is single-owner but the founder row lives here too. Will extend in Phase B when the register flow lands. |
| 11 | `services/user-org/app/services/team_membership.py:1` docstring | mentions "corporations + contractors" | **OUT** (nothing runs) | Provider is single-owner per spec — no team invites. Defensive rejection lives in auth.js. |
| 12 | `services/user-org/app/main.py:3` router imports | none-branching | **N/A** | Just an import list. Provider endpoints will register a `providers.py` router in Phase B. |
| 13 | `services/deal/app/routes/tenders.py:16` docstring | `x-user-role → 'contractor' \| 'corporation' \| 'admin'` | **OUT (naturally)** | Tender create at line 226 requires `x_user_role in ("contractor","admin")`; bid at line 463 requires `x_user_role == "corporation"`. Provider bounces off both without an explicit gate. |
| 14 | `services/admin/app/routes/approvals.py:312` `set_org_status` | `org_type not in ("contractor","corporation")` | **OUT (Phase A)** | Provider self-registers as `status='active'` and doesn't go through the admin approval queue. If suspension is needed later, a separate `/admin/providers/:id/suspend` endpoint targeting `service_providers` table — do NOT bolt it onto this route. |
| 15 | `services/admin/app/routes/approvals.py:103` `Literal["contractor","corporation"]` | admin doc-upload body | **OUT** | Provider has a single `logo_url` column populated at registration, not a document-approval flow. |
| 16 | `services/admin/app/routes/users.py:175` `set_org_status` | `org_type not in ("contractor","corporation")` | **OUT (Phase A)** | Same as #14. |
| 17 | `services/admin/app/routes/subscriptions.py:49` | list filter | **OUT (naturally)** | Provider has no `payment_db.subscriptions` row. Filter is used only to narrow that list. |
| 18 | `services/admin/app/routes/subscription_plans.py:39` | ORDER BY FIELD | **OUT** | Provider is free by decree — no plans, no seats. |
| 19 | `services/admin/app/routes/org_summary.py:348` | `regex="^(contractor\|corporation)$"` | **OUT (Phase A)** | Admin org-detail page is contractor/corp only. A future `/admin/providers` list will read from `service_providers` table separately. |
| 20 | `services/payment/app/routes/subscriptions.py:52` `VALID_TYPES` | `{"contractor","corporation"}` | **OUT** | Provider never touches Cardcom or `payment_db.subscriptions` — free row lives in `org_db.marketplace_subscriptions`. |
| 21 | `services/notification/src/dispatch/notifyEntity.js:61` jsdoc | `entityType: 'corporation'\|'contractor'` | **IN (Phase B)** | Provider has recipients (contact_phone/email on `service_providers`). Extend when the register flow ships. |
| 22 | `services/notification/src/consumers/handlers.js:272` | `recipient_role === 'contractor' ? 'contractor' : 'corporation'` | **OUT (naturally)** | Deal-service events. Providers don't participate in deals. |
| 23 | `services/notification/src/testCatalog.js:23,448` | descriptions | **OUT** | Documentation strings for the admin test panel. No logic branch. |
| 24 | `services/gateway/src/rateLimit.js:7` | comment | **OUT** | Comment only — the code uses `x-user-role` as-is. Provider role passes through rate limiting like any other. |
| 25 | `services/auth/src/routes/auth.js:500-501` `/invite/validate` | table pick | **OUT** (Phase A) | Provider invites are unsupported; the accept endpoint rejects them explicitly. Validate returns a wrong entity_name at worst — a cosmetic bug the accept-side rejection makes unreachable. |
| 26 | `services/auth/src/routes/auth.js:585` `/invite/accept` | `orgRole = 'contractor' \| 'corporation'` | **REJECTED** | Added `if (membership.entity_type === 'service_provider') return 400 provider_invites_unsupported`. Prevents wrong `users.role` mint. |
| 27 | Frontend types (`src/lib/*.ts`, `src/app/**/page.tsx`, `src/components/**/*.tsx`) | ~40 `'contractor' \| 'corporation'` unions | **OUT (frontend widens later)** | Frontend types will widen when the provider portal + admin surfaces need to render provider rows. Phase A backend is complete without touching them; Phase B adds `TrustBadge` (already includes `'service_provider'`) and any admin views that render providers. |
| 28 | `services/frontend/src/components/ads/TrustBadge.tsx:30` | `TrustEntity = 'corporation' \| 'contractor' \| 'service_provider'` | **ALREADY IN** | Union already includes provider — Phase B will render this on marketplace cards. |

## §2 · What Phase A shipped

**Migration:** `db/migrations/077_service_provider_entity.sql`
- Adds `service_provider` to 7 ENUM columns (idempotent per migration 022 pattern)
- Creates `org_db.service_providers` table

**Visibility:** `services/user-org/app/services/visibility.py`
- `viewer_scope_wheres` → `["1=0"], []` for provider
- New `require_no_service_provider()` → 403 `entity_type_forbidden`

**Reveal gate:** `services/user-org/app/routes/ads.py`
- `require_no_service_provider(x_entity_type)` at top of `contact_reveal`

**Whitelists extended (marketplace surface):**
- `marketplace.py:122` — `mine=true` filter
- `marketplace.py:265` — POST /listings
- `marketplace_subscriptions.py:42`
- `marketplace_uploads.py:68`

**Support tickets:** `support.py:41-42` — provider can file

**Defensive rejection:** `auth.js:531+` — `/invite/accept` returns 400 `provider_invites_unsupported` for provider memberships (prevents wrong `users.role` mint since providers are single-owner per spec).

## §3 · What is deliberately deferred

- **Provider registration route** (`POST /providers/register`) → Phase B
- **`/register/provider` UI + free `marketplace_subscriptions` row** → Phase B
- **`notifyEntity` extend for provider recipients** → Phase B (when register + team-management ships)
- **Admin provider list/suspend** → post-launch (not required by spec)
- **`entity_access.py` extend** → Phase B (when founder row is inserted at registration)
- **Frontend union widening** → Phase B/C (portal surfaces)

## §4 · Rules honored

- ✅ ENUM add-value only (no reorder/remove/rename). Migration 077 uses idempotent PREPARE-stmt pattern.
- ✅ Gate defaults are OUT (reject). `viewer_scope_wheres` returns explicit false clause for provider.
- ✅ Visibility rule lives in `visibility.py` only. No inline duplicates added.
- ✅ Nothing touched: `viewer_scope_wheres` core (extended, not restructured), `reveal` inner logic, `boost`, `quotas`, `query_rewriter.py`, `ranking`.
- ✅ Migration before code (L9): `077_service_provider_entity.sql` staged first.
