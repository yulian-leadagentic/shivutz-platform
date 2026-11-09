# CC prompt · R32 · One search for workers, housing and services

**Date:** 09.11.2026 · **Owner:** Yulian · **Branch:** confirm first (local `pivot/v2` and `origin/staging` both point at 27.09; report which one is the deploy branch before touching code)

## Why this round exists

The home search already federates services: `/api/search` returns `marketplace_matches` and `primary_section`, and `page.tsx` renders a "שירותים נלווים" section. The flow breaks the moment the user acts on that section:

1. "עוד בשירותים נלווים ←" sends the query to `/marketplace?search=`, which runs a **different and weaker** matcher (`marketplace.py:220`: title/description/city only, no category name, no stemming, no stopwords) than the federated pass (`search.py:255`). Same query, fewer or zero results.
2. A service card (`ListingCard`) navigates away to `/marketplace/[id]`, while worker and housing ads open in place.
3. The federated pass ignores what the rewriter understood: `filters.region` is never applied to `marketplace_listings.region`, and every token must match (`20`, `פועלים` can zero the result).
4. There is no way to narrow results by type on the home page, and only 6 services are shown.
5. The post-reveal cross link (`page.tsx:2995`) leaves the search for `/marketplace?category=housing`.

Two product decisions close the rest (below). The goal: **the user never leaves the search page to see, filter or open anything.**

## ⭐ Decisions (Yulian, 09.11) · binding for this round

**D1 · Corporation housing is visible to contractors and corporations only.**
- The rule is about housing **published by a corporation**: `ads` with `ad_type='housing'` (always corporation-owned) AND `marketplace_listings` with `category='housing'` AND `advertiser_entity_type='corporation'` (only corporations can publish housing there today, see `is_corp_housing` in `marketplace.py:503`). If a non-corporation housing listing ever exists, it is not covered by D1 and stays public.
- Visible to: contractor **approved or `pending`** · any corporation (including other corporations' housing) · admin · the owner of the row.
- Not visible to: anonymous · service provider.
- Worker ads are unchanged: a `pending` contractor still does not see them.
- **This changes the 19.09 matrix** (`decision_search_visibility_19_09.md`) in two cells: service providers no longer see corporation housing, and a pending contractor now does. Update the docstring in `visibility.py` and the matrix in that decision doc.
- Contact details stay behind the existing reveal. D1 is about seeing the listing at all.

**D2 · `/marketplace` becomes a redirect to the home page with the "services" type active.** Every existing URL keeps working:
- `/marketplace` → `/?type=services`
- `/marketplace?search=X&category=Y&region=Z` → `/?type=services&q=X&category=Y&region=Z`
- `/marketplace/[id]` → `/?type=services&listing=[id]` (opens the listing panel, see S5)
- Corporation/provider dashboards (`/corporation/marketplace`, `/provider/marketplace/new`) are **not** touched.

## STANDING RULE

`git tag pre-r32` before the first change. One commit per item. Run the regression battery (Acceptance §R) after S1, S2, S3 and at the end. **If a regression count changes, stop and report before continuing.**

---

# Items, in order

## S1 · Housing visibility (backend) · D1

1. `visibility.py` · `viewer_scope_wheres`: the `service_provider` branch becomes `["a.ad_type NOT IN ('worker','housing')"]`. Corporation, contractor, admin, anonymous branches unchanged.
2. `search.py` · pending contractor: today the caller appends `1=0` for a non-approved contractor. Change that append to `a.ad_type <> 'worker'`, so a pending contractor gets housing ads and still no worker ads. Keep `rejected`/`suspended` exactly as they are today and report what that is.
3. New helper next to `viewer_scope_wheres`, `marketplace_scope_wheres(x_entity_id, x_entity_type, x_user_role, approval_status)` for the `ml` alias:
   - admin / corporation / contractor `approved` or `pending` → `([], [])`
   - anonymous / service provider / contractor `rejected` or `suspended` → `(["NOT (ml.category = 'housing' AND ml.advertiser_entity_type = 'corporation')"], [])`
   - Same DB-free contract as `viewer_scope_wheres`; the caller passes `approval_status` (search.py already reads it via `contractor_approval_status`).
4. Apply it in **every** marketplace read path. Do not trust this list, grep `FROM marketplace_listings` and report each hit:
   - `_search_marketplace` (`search.py:255`) · it gets the viewer args now
   - `GET /marketplace` list (`marketplace.py` ~171)
   - `GET /marketplace/{id}` · a blocked caller gets **404** (same opacity the reveal endpoint uses), not 403
   - `POST /marketplace/{id}/reveal`
   - the activity feed and any sponsor/carousel query that reads listings
5. `search.py` response gains `"hidden_types": [...]`: `["workers","housing"]` for anonymous and service provider · `["workers"]` for a pending contractor · `["workers","housing"]` for a rejected or suspended contractor · `[]` for approved contractor, corporation (its worker scope stays "own only", that is not "hidden") and admin. The FE uses it for the lock states in S4. **It is derived from the viewer only, never from a count**, so it leaks nothing.

## S2 · One text matcher for services

Extract the per-token clause builder from `_search_marketplace` (4 fields incl. `mc.name_he` · raw + stem · stopwords) into one function in `app/services/search_normalize.py`, e.g. `marketplace_text_conditions(raw_query) -> (sql, params)`. Use it in both `_search_marketplace` and `GET /marketplace?search=`. The list endpoint needs the `LEFT JOIN marketplace_categories mc` it does not have today. After this, the same query returns the same services in both places.

## S3 · The federated pass uses what the rewriter understood

In `_search_marketplace` (it now receives `filters`):
1. **Region:** when `filters.region` is set, add `(ml.region = %s OR ml.region IS NULL)`. Soft filter, same rule as `available_from`: a listing with no region is nationwide and must not disappear.
2. **Tokens that the rewriter already consumed do not go into the AND:** pure numbers, region words, origin words, profession words (use the existing keyword maps in `query_rewriter.py` read-only, do not edit that file), and a short generic list (`עובדים · פועלים · צריך · אני · מחפש · מחפשים · בשביל · עבור`). Put the generic list next to `_MARKETPLACE_STOPWORDS`.
3. **Zero-result fallback:** if ≥2 tokens remain and the AND returns 0 rows, run once more with OR across the remaining tokens, ordered by the number of matched tokens (a `SUM(CASE …)` score), then `created_at DESC`. Log when the fallback fires.
4. Return up to `MARKETPLACE_LIMIT` (20) to the FE. The 6-card cap moves to the FE (S4).

## S4 · Type filter and "show more" in place (home results)

1. A segmented filter directly above the results: **הכל · עובדים · דיור · שירותים נלווים**, each with its count from the current `resp`. Client-side only, no new request. State lives in the URL (`?type=all|workers|housing|services`) so back/forward and shared links work. Default `all`.
2. A type listed in `hidden_types` keeps its tab, shows a lock icon instead of a count, and selecting it shows the existing sign-in/approval empty state for that viewer (anonymous → "התחברו כקבלן כדי לראות מודעות עובדים ודיור"; provider → corporation housing is for contractors and corporations; pending contractor, workers tab only → the existing `viewer_approval_status` copy).
3. **Housing is one section.** Housing ads (`results` with `ad_type='housing'`) and marketplace housing cards (`marketplace_matches` with `category='housing'`) render under one heading "דיור", ads first. Each card keeps its own component; only the grouping changes.
4. Services section: show 6, then "הצג עוד (N)" expands the rest **in place**. Replace the "עוד בשירותים נלווים ←" link with a button that sets `type=services`.
5. Under `type=services`, show the dynamic category chips from `marketplaceApi.listCategories()` (excluding `housing`, which is its own type). Selecting a chip filters client-side; `?category=` in the URL.
6. Sponsor placements that lived on `/marketplace` (`MarketplaceSponsorBanner`, `MarketplaceSponsorCarousel`) render at the top of the services section when `type=services`. **If any sponsor slot, impression or billing logic keys on the `/marketplace` path, stop and report instead of moving it.**

## S5 · A service card opens in place

1. Extract the body of `/marketplace/[id]/page.tsx` (details, gallery, reveal state, lead form if any) into `components/marketplace/ListingDetailPanel.tsx`. No behaviour change inside it.
2. On the home page, `ListingCard` opens that panel instead of navigating: side drawer on ≥lg, bottom sheet below. URL gets `?listing=<id>`; closing removes it; back button closes.
3. Modal rules from the design system: `role="dialog"`, `aria-modal`, focus trap, Esc, return focus to the card.
4. The cross-link inside the panel (and the post-reveal link at `page.tsx:2995`) runs a search **in place**: from a worker ad → `type=housing` with the ad's region in the query; from housing → `type=workers`. No navigation away.

## S6 · Redirects · D2

1. Implement as `redirects()` in `next.config` or a server `redirect()` in `app/marketplace/page.tsx` and `app/marketplace/[id]/page.tsx`, mapping params as listed in D2. **Temporary (307) in this round**; we switch to permanent after a week on staging.
2. `LandingNav` (`:106`, `:228`) links to `/?type=services`.
3. Keep `/marketplace/[id]` reachable as a redirect target only. Do not delete the route files; `ListingDetailPanel` is their content now.
4. Check that nothing server-side (emails, WhatsApp templates, sitemap, SMS) links to `/marketplace/...` with a path the redirect does not cover. Report each hit.

## S7 · Motion on the search and results pages

CSS and Tailwind keyframes only. **Do not add framer-motion or any animation library** (not in `package.json` today). Transform and opacity only, 150–300 ms, easing `cubic-bezier(.3,.7,.2,1)`. Everything sits inside the existing `prefers-reduced-motion` handling in `globals.css`: with reduced motion, every item below renders in its final state with no animation.

| # | Where | Effect |
|---|---|---|
| E1 | Search box | Focus: border to brand + soft ring (`#FDE9D8`) fades in 150 ms. Submit button: press scale .97 |
| E2 | "הבנתי" chips | Pop in on each new result set: scale .9→1 + fade, 40 ms stagger |
| E3 | Result cards | Fade-up 8px on a **new** result set only (not on re-render or filter change), 40 ms stagger, first 8 cards animated, the rest appear instantly |
| E4 | Type filter (S4) | Sliding active indicator under the selected tab (transform translate on one element, logical direction so it works in RTL); counts update with a short fade |
| E5 | Skeleton | Replace `animate-pulse` on result skeletons with a subtle shimmer sweep |
| E6 | Inline ad row expand | Smooth open/close with the `grid-template-rows: 0fr → 1fr` technique, no JS height measuring |
| E7 | Listing panel (S5) | Drawer slides from the inline-end on desktop, sheet slides up on mobile, backdrop fades |
| E8 | Type switch | Section crossfade 150 ms when `type` changes |
| E9 | Sticky search bar | Gains `shadow-card` once the page scrolls past the hero (IntersectionObserver sentinel, no scroll listeners) |
| E10 | Lock and empty states | Fade in 200 ms |

**Constraints that come from earlier rounds:**
- Zero layout shift. R31 fixed a jumping landing page; nothing in S7 may change box sizes after paint. Measure CLS before/after on `/` at 390 and 1280 and report both numbers.
- SP2 §1 still holds: the h1 is fully visible at `scroll=0`, the sticky bar never covers it, WCAG 2.4.11 still passes.
- `aria-live` announcements on the results stay exactly as they are: no double announcement because of animated mounting.

---

# Acceptance

## §R · Regression battery (before / after, report both numbers)

Run as approved contractor, with `LLM_REWRITER_FAKE_MODE` off and on:

| Query | Workers | Housing | Services |
|---|---|---|---|
| `רצפים סינים` | | | |
| `חשמלאים בצפון` | | | |
| `דיור ל-20 פועלים בחיפה` | | | |
| `הסעות בצפון` | | | |
| `ביטוח לעובדים זרים` | | | |
| `השכרת ציוד` | | | |

Worker counts must not change. Housing and services counts may only go **up** (S3), and each increase must be explained.

## §V · Visibility matrix (D1), checked on 4 endpoints

`/api/search` · `GET /api/marketplace` · `GET /api/marketplace/{housing id}` · `POST /api/marketplace/{housing id}/reveal`

| Viewer | Housing visible? |
|---|---|
| anonymous | ✗ (detail = 404) |
| contractor approved | ✓ |
| contractor pending | ✓ (worker ads still ✗) |
| corporation (not owner) | ✓ |
| corporation (owner) | ✓ |
| service provider | ✗ |
| admin | ✓ |

Non-housing services stay visible to everyone, including anonymous. Also check: a pending contractor's `/api/search` returns housing rows and zero worker rows.

## §F · Flow

- [ ] From a search with services, the user can filter to services, show more, open a listing and reveal, **without the URL path ever leaving `/`**
- [ ] Every D2 redirect lands on the right type, query, category and open listing
- [ ] Back button: closes the panel, then restores the previous type
- [ ] Same query on `/?type=services` and through the old `/marketplace?search=` returns the same services
- [ ] Screenshots at 390 and 1280: home before search, results `all`, results `services`, results `housing` as anonymous, listing panel open

## §M · Motion

- [ ] Each E1–E10 shown in a short screen recording or before/after frames
- [ ] With reduced motion forced on, no animation runs
- [ ] CLS before/after on `/` at 390 and 1280

# Guardrails

- **Do not touch:** `query_rewriter.py` (read its keyword maps only) · `query_reranker.py` · `MIN_RESULTS` · NM logic · reveal billing, subscription, quota, `contact_reveals`.
- If D1 touches anything that charges, counts or records a reveal, stop and report.
- Do not delete `/marketplace` route files or `ListingCard`.
- No new npm dependency.

# Report

Per item: what changed, file:line, evidence. Then: §R table, §V table, §F checklist, §M evidence, `git diff -w --stat`.

**End with a "Manual actions" section** (for example: env vars, redeploys, updating the decision doc on the project), or write "Manual actions: none".
