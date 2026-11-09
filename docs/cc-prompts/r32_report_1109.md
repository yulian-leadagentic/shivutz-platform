# R32 report · One search for workers, housing and services

**Date:** 09.11.2026 · **Baseline tag:** `pre-r32` (`d931bd8`) · **Branch:** `pivot/v2`, pushed to `origin/pivot/v2` and `origin/staging`

```
git rev-list --left-right --count origin/staging...origin/pivot/v2
0	0
```

**Deploy branch question (prompt header).** `origin/staging` and `origin/pivot/v2` were already identical at
`d931bd8` (27.09), and local `pivot/v2` matched both. There was nothing to resolve: day-to-day commits land on
`pivot/v2` and every push goes to both refs, which is what Railway staging builds from. B1 (is `staging` still in
the chain) is still open as a decision, but it did not block this round.

**Commits**

```
6089ced R32 S1 · corporation housing is for the people who hire the workers
eab5630 R32 S2 · the same query now returns the same services on both sides
f304886 R32 S3 · stop ANDing the words the rewriter already used
99b4ce4 R32 S4 · filter the results you already have, without leaving the page
362a222 R32 S5 · a service card opens where you are standing
2e684a6 R32 S6 · /marketplace becomes the services tab
c253061 R32 S7 · motion that reports state, on transform and opacity only
c93dc9e R32 S5 · the reveal 401 never fired (fix found during §F)
```

---

## Per item

### S1 · Housing visibility (D1)

| # | Change | Where |
|---|---|---|
| 1 | `service_provider` branch → `a.ad_type NOT IN ('worker','housing')` | `visibility.py:101` |
| 2 | Pending contractor appends `a.ad_type <> 'worker'`; `rejected`/`suspended`/missing row keep `1=0` | `search.py:468` |
| 3 | New `marketplace_scope_wheres(x_entity_id, x_entity_type, x_user_role, approval_status)`, DB-free, `ml` alias | `visibility.py:124` |
| 4 | Applied at every read path (list below) | `search.py:300`, `marketplace.py:221, 378, 466` |
| 5 | `hidden_types` on the search response, viewer-derived | `visibility.py:178`, `search.py:666` |
| — | Docstring matrix updated, two cells changed | `visibility.py:11-48` |

**What `rejected` / `suspended` do today, as asked in S1.2.** Before this round every non-approved contractor —
`pending`, `rejected`, `suspended`, and a contractor whose row has vanished mid-session — got the same `1=0`
appended, i.e. no ads at all. Only `pending` changed. The other three are untouched and still see no ads.

**Every `FROM marketplace_listings` read, as asked in S1.4** (grep, not the prompt's list):

| Site | Scoped? | Why |
|---|---|---|
| `search.py:300` `_search_marketplace` | yes | federated pass |
| `marketplace.py:221` `GET /marketplace` | yes | public list |
| `marketplace.py:378` `GET /marketplace/{id}` | yes → **404** | 403 would confirm the row exists |
| `marketplace.py:466` `POST /marketplace/{id}/reveal` | yes → **404** | gate sits *before* the audit insert |
| `marketplace.py:579` COUNT by `subscription_id` | no | slot accounting on the caller's own subscription |
| `marketplace.py:662, 725` owner check before PATCH/DELETE | no | write authorisation, a different gate |
| `marketplace_subscriptions.py:112` COUNT by `subscription_id` | no | same slot accounting |

No activity feed and no sponsor or carousel query reads `marketplace_listings`. Sponsor placements read
`sponsor_ads`, which `visibility.py`'s docstring already excludes by design.

**Guardrail check — "if D1 touches anything that charges, counts or records a reveal, stop and report".**
It touches one: `POST /marketplace/{id}/reveal` writes an audit row to `marketplace_reveals`. The D1 predicate is
in the same `WHERE` as the listing fetch, so a blocked caller 404s *before* the insert and no row is written. That
endpoint is explicitly **not metered** (`marketplace.py:362-377`) — no quota, no `contact_reveals`, no billing —
so the only effect is that refused reveals are no longer recorded as reveals, which is the intent. Nothing about
pricing, quota or `contact_reveals` was touched.

### S2 · One text matcher for services

Extracted to `search_normalize.marketplace_text_token_clauses` (`:167`) with
`marketplace_text_conditions` (`:223`) as the AND-joining wrapper. Both callers use it: `search.py:300` and
`marketplace.py:265`. The list endpoint gained the `LEFT JOIN marketplace_categories mc` it needs for the fourth
field (`marketplace.py:292`).

Evidence (local, direct HTTP at `:3002`, ASCII fixtures — see the Hebrew caveat below):

| Query | `/search` marketplace_matches | `GET /marketplace?search=` | identical |
|---|---|---|---|
| `R32` | 3 | 3 | yes |
| `shuttle` | 1 | 1 | yes |
| `QA transport` | 1 | 1 | yes |
| `R32 QA` | 3 | 3 | yes |

### S3 · The federated pass uses what the rewriter understood

1. Region soft filter `(ml.region = %s OR ml.region IS NULL)` — `search.py:354`.
2. Consumed-word pruning — `_rewriter_consumed_words` at `search.py:251`, reading `PROFESSION_KEYWORDS`,
   `ORIGIN_KEYWORDS`, `REGION_KEYWORDS` **read-only**. Generic list `_MARKETPLACE_REQUEST_WORDS` sits next to
   `_MARKETPLACE_STOPWORDS` at `search_normalize.py:129`.
3. OR fallback with a `CASE`-sum score, logged when it fires — `search.py:395`.
4. Returns up to `MARKETPLACE_LIMIT` (20); the 6-card cap moved to the frontend.

Token pruning, measured in-process on staging-equivalent code:

| Query | tokens | consumed | AND width |
|---|---|---|---|
| `רצפים סינים` | 2 | `סינים`, `רצפים` | 2 (guard restores — every word was consumed) |
| `חשמלאים בצפון` | 2 | `בצפון`, `חשמלאים` | 2 (guard restores) |
| `דיור ל-20 פועלים בחיפה` | 4 | `ל-20`, `פועלים` | 2 |
| `הסעות בצפון` | 2 | `בצפון` | **1** |
| `ביטוח לעובדים זרים` | 3 | — | 3 |
| `השכרת ציוד` | 2 | — | 2 |

Region soft filter, verified against fixtures with regions `north` / `south` / `NULL`:
`north` → 2 rows (north + NULL), `south` → 2 (south + NULL), `jerusalem` → 1 (NULL only), `national` → 3 (no filter).

**One deviation from the spec, deliberate.** `filters.region == 'national'` (the rewriter's reading of
`כל הארץ`) applies **no** region predicate. No listing carries `national`, so filtering on it would narrow the
result set to region-NULL rows — the opposite of "anywhere". Noted at `search.py:349`.

### S4 · Type filter and "show more" in place

New `components/search/ResultTypeFilter.tsx`; wiring in `page.tsx` (state at `:321-391`, derived counts at
`:430-470`, render at `:2079`). Housing is one section at `page.tsx:2490`; services at `:2560`.

- Counts come from the response in memory; no request on a tab change.
- URL state via the history API (`pushState` for a type, `replaceState` for a category), **not** `router.push`.
  The response is component state and R31 spent a round on remounts in this tree; a raw pushState cannot cost the
  visitor their results. Verified: Back restores the previous tab with the results still on screen.
- `hidden_types` → a lock instead of a count. **The lock means restricted, not empty**: an anonymous visitor
  still sees a contractor-published housing listing under the locked דיור tab, because D1 only covers
  corporation housing.
- Services: 6 then `הצג עוד (N)` in place. The old `/marketplace?search=` link is now a button that selects the
  services tab.
- Category chips from `marketplaceApi.listCategories()`, `housing` excluded, `?category=` in the URL.
- `MarketplaceSponsorBanner` + `MarketplaceSponsorCarousel` render at the top of the services section when
  `type=services` — see the sponsor note below.

**Sponsor guardrail — checked, not assumed.** Nothing in `MarketplaceSponsors.tsx` reads `usePathname`,
`location.pathname` or the string `/marketplace`. Placements are keyed by **name**
(`marketplace_banner`, `marketplace_carousel`) and bucketed by `placementBucket` (`:61-79`), which maps
`marketplace*` → `marketplace`. Moving the components keeps that bucket, so admin CTR for the marketplace product
keeps accumulating. **The open question is semantic, and it is yours:** after D2 those two placements only ever
render inside the home page's services tab, so "marketplace banner" now means "services tab on `/`". If any
advertiser contract names the marketplace *page*, the placement should be renamed — exactly the R30 §12b
situation where `listing_rail` impressions were landing in `side_rail`'s bucket. I did not rename anything.

### S5 · A service card opens in place

- `components/marketplace/ListingDetailPanel.tsx` — the body, lifted out of the route verbatim except for the two
  changes the panel context forces (login `returnTo` now carries the query string; "back to all listings" becomes
  a close button in panel mode). `ListingDetailDrawer` in the same file is the dialog shell.
- `app/marketplace/[id]/page.tsx` keeps its chrome and `SponsorProvider` and renders the panel.
- `ListingCard` gained an optional `onOpen`. It stays an `<a>` with a real href (`/?type=services&listing=<id>`),
  so copy-link and open-in-new-tab work and a modified click still navigates.
- Dialog rules: `role="dialog"`, `aria-modal`, focus trap, Esc, focus returned to the card, body scroll locked.
- Cross-flow link after a reveal runs the search in place (`page.tsx:670` `crossSearch`), carrying the ad's region.

Measured in the browser: desktop drawer 704px at the inline-end, full height, rounded on the page-facing edge;
mobile sheet full width, bottom-anchored, 88vh. Esc closes and drops `?listing=`; Back closes and returns focus
to the card (`document.activeElement` was the card's `<a>`), with the results still rendered.

**Bug found while walking §F and fixed (`c93dc9e`).** The reveal's 401 branch read `e.status`, but `apiFetch`
puts it on `ApiError.cause.status`. The branch had never run, so an anonymous visitor asking for contact details
was told *"make sure your account is approved"* — advice with no account behind it. This was carried over verbatim
from the route page, where it was equally broken. Now verified on staging: anonymous reveal →
`/login?returnTo=/?q=…&listing=…`, i.e. login returns you to the open panel.

### S6 · Redirects (D2)

`next.config.js` `redirects()`, all `permanent: false` (307):

| From | To | Verified |
|---|---|---|
| `/marketplace` | `/?type=services` | yes |
| `/marketplace?search=X&category=Y&region=Z` | `/?type=services&q=X` + params passed through | yes |
| `/marketplace/[id]` | `/?type=services&listing=[id]`, panel opens | yes |

`LandingNav:106` and `:228` now point at `/?type=services`.

Both page files stay in place and still render, so removing the three rules is the whole revert.

**S6.4, server-side links.** One exists: `providers.py:427` builds `{frontend_url}/provider/marketplace/new?category=…`
for the provider welcome email — D2 explicitly leaves provider dashboards alone, so no change. No sitemap, no
robots, no SMS or WhatsApp template links into `/marketplace`.

**Four in-app links left on `/marketplace`**, riding the redirect rather than pointing at the destination:
`how-it-works/page.tsx:266`, `provider/dashboard/page.tsx:111`, `LandingFooter.tsx:26`,
`MarketplacePreview.tsx:95`. The prompt named only LandingNav; say the word and they take one line each.

### S7 · Motion

Ten effects, CSS only, in `globals.css` under `R32 S7 · motion`. No dependency added — `package.json` is
untouched this round. Every effect moves `transform` or `opacity`.

Two implementation notes worth keeping:

- **E3 and E8 are attributes, not React keys.** Remounting the sections to replay an animation would re-fire every
  sponsor `useAdImpression` inside them. An impression counted twice is a billing question, not a motion one.
- **E9's shadow is the `shadow-card` utility toggled in JSX.** Tailwind's box-shadow utilities compose through
  `--tw-shadow` and beat a plain rule whatever the source order; a hand-written `.is-stuck { box-shadow }` computed
  to transparent. The CSS owns only the transition.

**A contrast fix carried in.** The S4 category chips first used `bg-brand-600 text-white`. `page.tsx:1558-1566`
records that this repo measured white on brand-600 at **2.6:1** and rejected it in favour of slate-900 at
**6.93:1**. The chips now use the slate-900 pairing. This contradicts the standing "white text on primary-600"
note — the in-repo measurement is the one I followed; worth settling which is right.

---

## §R · Regression battery

Run against **staging** (your call this round, since the local DB is 28 migrations behind with no inventory).
`LLM_REWRITER_FAKE_MODE` is not set on staging and `ANTHROPIC_API_KEY` is, so these are **real-mode** numbers.
Anonymous viewer — see the gap note below.

| Query | Workers before → after | Housing before → after | Services before → after |
|---|---|---|---|
| `רצפים סינים` | 0 → 0 | 0 → 0 | 0 → 0 |
| `חשמלאים בצפון` | 0 → 0 | 0 → 0 | 0 → 0 |
| `דיור ל-20 פועלים בחיפה` | 0 → 0 | 0 → 0 | 0 → 0 |
| `הסעות בצפון` | 0 → 0 | 0 → 0 | **0 → 1** |
| `ביטוח לעובדים זרים` | 0 → 0 | 0 → 0 | 1 → 1 |
| `השכרת ציוד` | 0 → 0 | 0 → 0 | **0 → 3** |

**Worker counts did not change.** Two services increases, both explained:

- `הסעות בצפון` **0 → 1.** `בצפון` was in the conjunctive AND over service text, where no transport listing
  contains it. S3.2 prunes it; S3.1 then applies `north` as a *soft* region filter, and of the four transport
  listings on staging (sharon, center, south, north) the north one survives along with any region-NULL listing.
  One result, and the right one.
- `השכרת ציוד` **0 → 3.** `השכרת` matched nothing, zeroing the AND. The OR fallback (S3.3) now runs and returns
  the three equipment listings, ranked by matched-token count.

Three queries still return 0 services, all correctly: `רצפים סינים` and `חשמלאים בצפון` are worker queries whose
every token is a profession/origin/region word, so the guard restores the original tokens and nothing in the
services catalogue matches them. `דיור ל-20 פועלים בחיפה` returns 0 **for an anonymous viewer** because all four
housing listings on staging are corporation-owned and D1 now hides them; the OR fallback finds them for a
contractor.

**Gap, stated plainly.** §R asks for an approved contractor. `/api/search` is public so the anonymous pass above
is real, but the Workers and Housing columns are structurally 0 for anonymous and cannot show the housing
increase. Running it as an approved contractor on staging needs either `railway ssh` (the R13 direct-HTTP
pattern) or a QA login — see Manual actions.

## §V · Visibility matrix

Run locally against user-org at `:3002` with explicit `x-entity-*` headers — the R13 pattern, which covers every
persona without creating a membership on, or otherwise touching, a real account. Fixtures: one
corporation-owned housing listing, one contractor-owned housing listing, one services listing, one worker ad,
one housing ad.

| Viewer | housing ads | worker ads | hidden_types | corp housing in `/search` | in `GET /marketplace` | `GET /{id}` | `POST /{id}/reveal` |
|---|---|---|---|---|---|---|---|
| anonymous | 0 | 0 | workers,housing | ✗ | ✗ | **404** | 401 |
| contractor approved | 1 | 1 | — | ✓ | ✓ | 200 | (see note) |
| contractor pending | **1** | **0** | workers | ✓ | ✓ | 200 | 403 |
| corporation (not owner) | 1 | 0 (own only) | — | ✓ | ✓ | 200 | (see note) |
| corporation (owner) | 1 | 0 (own only) | — | ✓ | ✓ | 200 | (see note) |
| service provider | **0** | 0 | workers,housing | **✗** | **✗** | **404** | **404** |
| admin | 1 | 1 | — | ✓ | ✓ | 200 | 401 |

Every cell matches D1. The contractor-owned housing listing and the services listing stayed visible to **every**
viewer including anonymous, which is the half of D1 that is easy to over-apply.

Three notes on the reveal column:

- **(see note)** = HTTP 500 locally, because `org_db.marketplace_reveals` does not exist on this machine
  (migration 086, beyond the 68 applied here). That the blocked viewers got 404/401/403 *without* reaching the
  missing table is itself the proof that the D1 gate runs ahead of the audit insert.
- **pending contractor 403** is the pre-existing approval gate, not D1. D1 says contact details stay behind the
  existing reveal, and they do.
- **admin 401** is pre-existing: the endpoint requires an entity id and type, and an admin has neither.

Verified on staging for the anonymous row against real inventory: `GET /api/marketplace` returned **16 listings
before, 12 after** — exactly the four corporation housing rows — and `hidden_types` comes back
`['workers','housing']`.

## §F · Flow

- [x] From a search with services: filter to services, show more, open a listing, ask for contact — the path
      never leaves `/` (verified on staging; `location.pathname === '/'` with the dialog open). The reveal itself
      correctly requires login for an anonymous visitor, and now sends them there with the panel in `returnTo`.
- [x] Every D2 redirect lands on the right type, query, category and open listing.
- [x] Back closes the panel, then restores the previous type. Focus returns to the card.
- [x] The same query returns the same services through both doors — `/marketplace?search=` now redirects into the
      same federated search, and the two endpoints were separately verified to return identical sets.
- [x] Screenshots at 390 and 1280: home before search, results `all`, results `services`, results `housing` as
      anonymous, listing panel open. (In the session transcript.)

**One cosmetic finding:** at 375–390px the fourth tab label truncates to `שירותים נלו…`. Legible and consistent,
but a shorter mobile label would read better.

## §M · Motion

- [x] E1–E10 all render; the mechanics were verified in the DOM (indicator `transition-property: transform`,
      form `transition-property: box-shadow, border-color`, drawer geometry at both breakpoints, sticky bar
      flat at `scroll=0` and shadowed once the sentinel leaves view).
- [x] **Reduced motion:** the `prefers-reduced-motion` block covers every S7 selector. Applying its declarations
      unconditionally drops the chip animation to `animation-name: none` and the indicator to
      `transition-duration: 0.001s`.
- [x] **CLS, same environment, same 8-second window, `/` with no query:**

| Width | before (`pre-r32`) | after | Δ |
|---|---|---|---|
| 390 | 0.0009 | 0.0009 | 0 |
| 1280 | 0.0049 | 0.0049 | 0 |

  Measured by running the `pre-r32` worktree as a second dev server beside the current one, so both sides share
  the environment. **S7 added no layout shift.**

**A pre-existing shift worth its own look.** On *staging* (which has sponsor inventory; local has none) `/`
intermittently records a single 0.067–0.115 shift. Its sources are
`SECTION.bg-gradient-to-b from-slate-50 to-white` and the `איך זה עובד?` row at `page.tsx:1772` — both untouched
this round — and it only appears when the measurement window catches the event. At 390 that pushes the page over
the 0.1 "good" threshold. This is R31's reserved-band territory plus late sponsor resolution, not S7, but it is
real and nobody is currently measuring it.

## `git diff -w --stat pre-r32..HEAD`

```
 docs/cc-prompts/cc_prompt_R32_unified_search.md    | 174 ++++++
 services/frontend/next.config.js                   |  34 ++
 services/frontend/src/app/globals.css              | 288 +++++++++
 services/frontend/src/app/marketplace/[id]/page.tsx| 390 +-----------
 services/frontend/src/app/page.tsx                 | 652 +++++++++++++++++----
 services/frontend/src/components/landing/LandingNav.tsx | 13 +-
 services/frontend/src/components/marketplace/ListingCard.tsx | 27 +-
 services/frontend/src/components/marketplace/ListingDetailPanel.tsx | 541 ++++++++++
 services/frontend/src/components/search/ResultTypeFilter.tsx | 106 ++++
 services/frontend/src/lib/api/search.ts            |  10 +
 services/user-org/app/routes/marketplace.py        | 115 +++-
 services/user-org/app/routes/search.py             | 306 ++++++----
 services/user-org/app/services/search_normalize.py | 155 ++++-
 services/user-org/app/services/visibility.py       | 132 ++++-
 14 files changed, 2323 insertions(+), 620 deletions(-)
```

---

## Other things found, not changed

1. **`_search_marketplace` has no seed gate.** `GET /marketplace` filters seed rows in production via
   `seed_where('ml')`; the federated pass in `search.py` does not. In production the search section would serve
   demo listings that the marketplace list hides. One line to fix, but it is a behaviour change outside this
   round's scope and R30's policy decision is yours.
2. **`?region=` on the home page is dropped from the URL by the first search.** The mount effect restores it into
   the filter chip (`page.tsx:588`), but `runSearch` then writes `syncFiltersToUrl(fProf, fRegion, fOrigin)` from
   a stale closure where it is still empty, deleting the param. Pre-existing; now visible through the D2 redirect,
   which does carry `region` into the destination as D2 specifies.
3. **Local dev environment is in poor shape** — 28 migrations unapplied, the `user-org` image predates U3, the
   frontend's file watcher fails with `Watchpack EIO` on the bind mount (every change needs a container restart),
   and the Hebrew in `marketplace_categories.name_he` is double-encoded mojibake (`scripts/reseed_hebrew.sql`
   exists for this). This is why Hebrew matching had to be proved on staging.

## Manual actions

1. **Update the decision doc.** `decision_search_visibility_19_09.md` is not in the repo — it lives on the
   project, so the D1 matrix change (service provider loses housing; pending contractor gains it) has to be
   applied there by hand. The `visibility.py` docstring is already updated.
2. ~~`railway login`~~ **— done. Both batteries have been re-run on staging as every viewer; see the addendum.**
   Two things it turned up need you: **staging's `ANTHROPIC_API_KEY` is rejected by Anthropic on every call**, so
   the search has been running on its regex fallback (check whether production shares that key), and one worker
   count moved — `השכרת ציוד` 14 → 0 — which needs a yes or no from you.
3. **Decide the sponsor placement question** in S4 above: `marketplace_banner` / `marketplace_carousel` now render
   on `/`, not on a marketplace page. Rename or leave.
4. **Switch the redirects to 308** after a week on staging — three `permanent: false` → `true` in
   `next.config.js`.
5. **Settle the orange-on-white rule.** The repo says slate-900 on brand-600 (6.93:1) and that white fails at
   2.6:1; the standing note says white. They disagree, and both are currently being followed in different places.
6. No env vars, no migrations, no seed data. This round added no DB columns.

**Local test fixtures left behind** (local MySQL only, nothing on staging): 13 `r32-*` rows in
`marketplace_listings`, and both rows in `ads` had `expires_at` pushed to 2027-12-31 so the ads path returned
anything at all. Remove with
`DELETE FROM marketplace_listings WHERE id LIKE 'r32-%';` — say the word and I will.

---

# Addendum · staging acceptance as authenticated viewers (after `railway login`)

Run through `railway ssh --service user-org`, direct HTTP at `localhost:3002` with explicit `x-entity-*` headers.
Staging inventory at the time: 8 contractors (all approved), 14 live worker ads, 4 live housing ads, 16
marketplace listings of which 4 are corporation housing.

## §R · staging · approved contractor · before → after

"Before" is reconstructed rather than remembered: the ads pass for an approved contractor was not changed this
round, so it is run through the app's own `_build_where`; only the marketplace matcher is reimplemented as it
stood at `pre-r32` (all tokens ANDed, no pruning, no region filter, no OR fallback). R30 §31b's suppression is
then applied using the **old** marketplace count.

| Query | Workers | Housing (ads+mkt) | Services |
|---|---|---|---|
| `רצפים סינים` | 1 → 1 | 0 → 0 | 0 → 0 |
| `חשמלאים בצפון` | 0 → 0 | 0 → 0 | 0 → 0 |
| `דיור ל-20 פועלים בחיפה` | 0 → 0 | **0 (0+0) → 4 (0+4)** | 0 → 0 |
| `הסעות בצפון` | 2 → 2 | 0 → 0 | **0 → 1** |
| `ביטוח לעובדים זרים` | 0 → 0 | 0 → 0 | 1 → 1 |
| `השכרת ציוד` | **14 → 0** | 0 → 0 | **0 → 3** |

### One worker count changed, and the standing rule says stop and report

`השכרת ציוד`: **Workers 14 → 0.**

This is not the ads pass changing. It is **R30 §31b firing for the first time on this query**. That rule says: if
the rewriter extracted nothing narrowing (no profession, origin or region) **and** the marketplace matched, the
unfiltered worker rows are inventory rather than an answer, so they are dropped. Before this round the services
side matched 0 for `השכרת ציוד`, so the rule never triggered and the query returned the entire worker table — 14
ads about workers, for a question about renting equipment. S2 and S3 made the services side match 3, so the rule
now does what it was written to do.

So the count moved because a pre-existing rule finally had something to fire on. **It is still a change in the
Workers column, and it is your call to confirm**: either this is R30 working as intended (my reading — "inventory
dressed as a match is the lie"), or the suppression should not apply when the marketplace hits come from the new
OR fallback rather than from a direct match.

The housing increase on `דיור ל-20 פועלים בחיפה` (**0 → 4**) is S3 end to end: `ל-20` and `פועלים` are pruned as
rewriter-consumed, the remaining `דיור` + `בחיפה` AND still matches nothing, and the OR fallback then finds the
four housing listings through the category display name, ranked by matched-token count.

### Rewriter mode

§R asks for `LLM_REWRITER_FAKE_MODE` off and on. On staging it is **unset**, and `ANTHROPIC_API_KEY` **is** set —
so the code selects real mode, and then every single call logs:

```
[qrewrite] mode=real model=claude-haiku-4-5-20251001 timeout=3.0s
[qrewrite] fallback:auth (0.04s) — AuthenticationError
```

The key is present but Anthropic rejects it, so `rewrite()` falls back to the regex extractor on every query.
**Both halves of §R therefore currently produce the same numbers**, because staging is running the fake extractor
whether you ask for it or not. The tables above are honest, but they are fake-mode tables.

This is not an R32 regression — it predates the round — but it means staging search has been running on the regex
fallback for an unknown stretch, and nobody would notice from the outside because the fallback returns plausible
results. **Worth checking whether production shares the key.**

## §V · staging · full matrix

| Viewer | housing ads | housing mkt | worker ads | hidden_types | corp housing in `/search` | in `GET /marketplace` | `GET /{id}` | `POST /{id}/reveal` |
|---|---|---|---|---|---|---|---|---|
| anonymous | 0 | 0 | 0 | workers,housing | ✗ | ✗ | **404** | 401 |
| contractor approved | 0 | 4 | 1 | — | ✓ | ✓ | 200 | **200, contact returned** |
| contractor pending | 0 | **4** | **0** | workers | ✓ | ✓ | 200 | 403 |
| corporation (not owner) | 0 | 4 | 0 (own only) | — | ✓ | ✓ | 200 | 200, contact returned |
| corporation (owner) | 0 | 4 | 0 (own only) | — | ✓ | ✓ | 200 | 200, contact returned |
| service provider | 0 | 0 | 0 | workers,housing | **✗** | **✗** | **404** | **404** |
| admin | 0 | 4 | 1 | — | ✓ | ✓ | 200 | 401 |

Every cell matches D1. The non-housing service listing stayed visible to **every** viewer including anonymous.

Two columns need a word so they are not misread:

- **`housing ads` is 0 for everyone**, including admin, even though staging has 4 live housing ads. That is R30
  §31b again: the probe query `דיור` extracts nothing narrowing and the marketplace matches, so the housing *ads*
  are suppressed in favour of the housing *listings*. Pre-existing, and identical before the round.
- **admin `POST /reveal` → 401** is pre-existing: the endpoint requires an entity id and type, and an admin
  picking "מנהל מערכת" has neither. Not a D1 effect.

The local run's one gap is now closed: `POST /{id}/reveal` returns **200 with contact details** for an allowed
viewer on staging, so the D1 scope in that endpoint's `WHERE` lets the right people through — it was only the
missing `marketplace_reveals` table that made it 500 locally.

### What this run touched on staging

- **One seed contractor** (`b9b3bf0f-621c-469f-ab69-18e405efa0dc`, `קבוצת הרצל`, `is_seed=1`) was flipped
  `approved → pending` for the few seconds the pending row took, then restored inside a `finally`. Verified
  afterwards: 8 approved contractors, which is what it was before. A seed row was chosen deliberately so that no
  real contractor's approval status moved at all.
- **Audit rows in `marketplace_reveals`**, against one corporation housing listing. They are idempotent per
  (viewer, listing). Blocked viewers 404 ahead of the insert and left nothing.

  > **Corrected at close-out (addendum 5).** It was **three** rows, not four — admin 401s before the insert
  > because it carries no entity id. And **do not run the one-liner this paragraph originally gave**
  > (`DELETE … WHERE listing_id='3ba6303b-…'`): that listing also carries a genuine reveal from
  > 22 September by a real contractor, and the blunt delete would have taken it with the QA rows. The rows
  > were removed by timestamp instead; see addendum 5.
- Nothing else. No schema change, no listing, no ad, no account.

---

# Addendum 2 · after the key rotation and the R1 refinement

## 1 · The rewriter is really in real mode

```
[qrewrite] mode=real model=claude-haiku-4-5-20251001 timeout=3.0s
```

and **zero** `fallback:auth` lines in the logs, where previously every single call logged one.

The banner alone would not prove much — it is printed at import from the presence of a key, not from a
successful call. The result that does prove it is `canonical_query`, which only the LLM path rewrites:

| Query | fake | real |
|---|---|---|
| `רצפים סינים` | `רצפים סינים` | `flooring workers from China` |
| `חשמלאים בצפון` | `חשמלאים בצפון` | `electricians in the north` |
| `דיור ל-20 פועלים בחיפה` | `דיור ל-20 פועלים בחיפה` | `housing for 20 workers in Haifa` |
| `הסעות בצפון` | `הסעות בצפון` | `transportation in the north` |
| `ביטוח לעובדים זרים` | `ביטוח לעובדים זרים` | `insurance for foreign workers` |
| `השכרת ציוד` | `השכרת ציוד` | `equipment rental` |

## 2 · §R in both modes, approved contractor, after R1

Run in-process on staging with `FAKE_MODE` flipped per call, so nothing on the service was reconfigured and no
redeploy was needed. The two modes cannot contaminate each other: only `rewrite_real` touches the Redis cache,
and `rewrite_fake` never reads it.

| Query | mode | Workers | Housing (ads+mkt) | Services | which pass | primary | extracted |
|---|---|---|---|---|---|---|---|
| `רצפים סינים` | fake | 1 | 0 | 0 | none | ads | flooring · CN |
| `רצפים סינים` | **real** | 1 | 0 | 0 | none | ads | flooring · CN |
| `חשמלאים בצפון` | fake | 0 | 0 | 0 | none | ads | electrician · north |
| `חשמלאים בצפון` | **real** | 0 | 0 | 0 | none | ads | electrician · north |
| `דיור ל-20 פועלים בחיפה` | fake | 0 | **4** (0+4) | 0 | OR | marketplace | qty 20 |
| `דיור ל-20 פועלים בחיפה` | **real** | 0 | **1** (0+1) | 0 | OR | marketplace | qty 20 · **region north** |
| `הסעות בצפון` | fake | 2 | 0 | 1 | AND | ads | north |
| `הסעות בצפון` | **real** | 2 | 0 | 1 | AND | ads | north |
| `ביטוח לעובדים זרים` | fake | 0 | 0 | 1 | AND | marketplace | — |
| `ביטוח לעובדים זרים` | **real** | 0 | 0 | 1 | AND | marketplace | — |
| `השכרת ציוד` | fake | **14** | 0 | 3 | **OR** | marketplace | — |
| `השכרת ציוד` | **real** | **14** | 0 | 3 | **OR** | marketplace | — |

**The counts differ on exactly one query**, and for a good reason. On `דיור ל-20 פועלים בחיפה` the real
rewriter extracts `region: north` from `בחיפה` — Haifa is a city, and no city appears in
`REGION_KEYWORDS`, so the regex extractor cannot make that leap. S3.1's soft region filter then does its job:
housing drops from all four listings to the one in the north plus any with no region at all. Fewer rows, and
the right ones. Measured against the pre-R32 baseline for that query (0), real mode is still an increase.

The other five queries agree between modes because the regex extractor already gets them right — the keyword
maps cover `רצפים`, `סינים`, `חשמלאים`, `צפון` directly.

## 3 · Which pass produced `השכרת ציוד`'s three services — and the R1 refinement in effect

**The OR fallback**, confirmed by calling `_search_marketplace` in-process and reading the flag rather than
inferring it. `השכרת` matches no listing text (the equipment listing says `השכרה`, and the stemmer only strips
`ים`/`ות`, so it does not bridge the two), which empties the AND; `ציוד` alone then reaches the three equipment
listings through their category display name.

So under R1 that query no longer suppresses: **Workers is back to 14**, services lead
(`primary_section='marketplace'`), and the unfiltered worker list sits underneath in the broad-browse state the
frontend already labels.

Per-query, after R1, the suppression rule now fires exactly once:

| Query | marketplace pass | narrowing extracted | workers suppressed |
|---|---|---|---|
| `רצפים סינים` | none | yes | no |
| `חשמלאים בצפון` | none | yes | no |
| `דיור ל-20 פועלים בחיפה` | OR | real: yes / fake: no | no |
| `הסעות בצפון` | AND | yes (region) | no |
| `ביטוח לעובדים זרים` | **AND** | no | **yes** |
| `השכרת ציוד` | OR | no | **no — was yes before R1** |

`ביטוח לעובדים זרים` is the one that still suppresses, and it is the case the rule was written for: a direct AND
hit on an insurance service, nothing narrowing extracted, so the worker rows really are inventory.

## 4 · §R, the whole round, one table

Workers / Housing / Services, approved contractor.

| Query | pre-R32 | post-R32, pre-R1 | after R1 (fake) | after R1 (real) |
|---|---|---|---|---|
| `רצפים סינים` | 1 / 0 / 0 | 1 / 0 / 0 | 1 / 0 / 0 | 1 / 0 / 0 |
| `חשמלאים בצפון` | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| `דיור ל-20 פועלים בחיפה` | 0 / 0 / 0 | 0 / **4** / 0 | 0 / 4 / 0 | 0 / **1** / 0 |
| `הסעות בצפון` | 2 / 0 / 0 | 2 / 0 / **1** | 2 / 0 / 1 | 2 / 0 / 1 |
| `ביטוח לעובדים זרים` | 0 / 0 / 1 | 0 / 0 / 1 | 0 / 0 / 1 | 0 / 0 / 1 |
| `השכרת ציוד` | **14** / 0 / 0 | **0** / 0 / **3** | **14** / 0 / 3 | **14** / 0 / 3 |

**Worker counts now match the pre-R32 baseline on every query.** The one that moved is back where it was, and
it moved back for the right reason rather than by disabling the rule: suppression still fires on a direct hit
(`ביטוח לעובדים זרים`), it just no longer fires on a fallback hit. Housing and services are up on two queries
and down on none.

## 5 · Something the working key exposed

With the rewriter reaching Anthropic, the **reranker** now runs too — and it logs this on two of the six
queries (corrected: I first wrote three, having counted log lines across both modes rather than queries):

```
[qrerank] unparseable (0.36s) → sql order kept
```

So `query_reranker` is authenticating, spending a call, returning something the parser rejects, and falling
back to SQL order. The ordering is not wrong, but the rerank is a no-op on those queries and is being paid for.
This was invisible while the key was dead, because every call failed earlier in the chain.

Out of scope here — `query_reranker.py` is on this round's do-not-touch list — but it wants a look.

---

# Addendum 3 · the reranker "unparseable" line, investigated

Nothing was changed. `query_reranker.py` is on this round's do-not-touch list; this is the diagnosis and the
options.

## It is not a parse failure. The model returns an empty array.

Captured on staging by spying on `_extract_id_list` and then re-issuing the same prompt directly:

```
query: השכרת ציוד
candidates sent: 14
raw reply: '```json\n[]\n```'      (14 chars)
parsed ids: 0
stop_reason: end_turn              → not truncation
usage: input_tokens=1692, output_tokens=9
content block types: ['text']
```

The parser is fine. It strips the fences, `json.loads("[]")` succeeds, the result is a list, the loop over zero
items produces `[]` — and then `query_reranker.py:163` hits `if not ranked:` and prints **"unparseable"**.

So `_extract_id_list` returns `[]` for two different outcomes — *"I could not parse this"* and *"I parsed it and
the model named nothing"* — and the log reports both as the first. **That conflation is the whole defect.** It
cost me a detour looking for a parser bug, and it would cost the next person the same.

## Why the model answers `[]`

Because it is right. The ranking prompt for `השכרת ציוד` ("equipment rental") is handed fourteen **worker** ads
and asked to order them by relevance. None of them are relevant, so it returns none.

That only happens on the queries where the ads pass returned the whole worker table, which is the
unfiltered-inventory shape R30 §31b was written for. Measured per query:

| Query | candidates sent to rerank | model reply | parsed |
|---|---|---|---|
| `ביטוח לעובדים זרים` | 14 | `` ```json\n[]\n``` `` | 0 |
| `השכרת ציוד` | 14 | `` ```json\n[]\n``` `` | 0 |
| `חשמלאים בצפון` | — below `RERANK_MIN` (5), skipped | — | — |
| `הסעות בצפון` | — below `RERANK_MIN` (5), skipped | — | — |
| `רצפים סינים` | — below `RERANK_MIN` (5), skipped | — | — |
| `דיור ל-20 פועלים בחיפה` | — below `RERANK_MIN` (5), skipped | — | — |

The reranker reaches the model on exactly the two queries that extract nothing narrowing, and on both it says
"none of these". Every query that extracted a profession or a region has too few candidates to rerank at all.

## What it costs

Ordering: nothing. SQL order is kept, which is the right order for a list the model just called irrelevant.

Tokens: ~1,692 input per such search, for a nine-token answer. Small per call, but it fires on precisely the
broad queries a browsing contractor types, and the work is thrown away either by the empty reply or by R30's
suppression a few lines later.

Observability: the real cost. A log line that says "unparseable" when nothing failed to parse.

## Three options, in the order I would take them

1. **Tell the two outcomes apart.** Have `_extract_id_list` return `None` when it genuinely cannot parse and
   `[]` when it parsed to nothing, then log `[qrerank] model ranked nothing` separately from
   `[qrerank] unparseable`. Four lines in `query_reranker.py`. This is the one that is actually broken.
2. **Do not rerank unfiltered inventory.** The rerank runs *before* R30's suppression, on candidates that are
   about to be judged irrelevant anyway. Skipping it when the rewriter extracted no profession, origin or
   region removes the call in exactly these cases — and that is a change in `search.py`, which this round
   already owns, not in the reranker.
3. **Leave the prompt alone.** It would be easy to add "if none are relevant, return them in the given order",
   and it would silence the line — but it would also throw away the one genuinely useful thing the model said.

## One thing worth your attention, given R1

The reranker's `[]` is an independent judgement that the candidate list does not answer the query — arguably a
stronger signal than "the marketplace matched something", which is what R30 §31b keys on today.

After R1, `השכרת ציוד` shows its 14 worker ads (correctly, per your decision — the marketplace evidence came
from the OR fallback and is too weak to delete them). But on that same query the reranker, looking only at the
ads, independently returned "none of these are relevant".

I am not re-opening R1: the marketplace-evidence question is settled and implemented. This is new evidence that
arrived afterwards, and if you ever want a second suppression signal that does not depend on the marketplace at
all, this is it.

---

# Addendum 4 · both reranker fixes, applied and verified on staging

Commit `d461b56`. Yulian asked for both options from addendum 3.

## Fix 1 · the parser tells its two outcomes apart

`_extract_id_list` returns `None` only when the response genuinely cannot be parsed, and a list — possibly
empty — when it can. The caller branches on `is None` for `[qrerank] unparseable`, and an empty ranking gets its
own message that echoes the first 40 characters of the reply, so `[]` and a list of hallucinated ids are
distinguishable without re-running anything.

Verified against seven inputs on staging:

| reply | returns | reading |
|---|---|---|
| `` ```json\n[]\n``` `` | `[]` | parsed, nothing named ← **the case that used to say "unparseable"** |
| `[]` | `[]` | parsed, nothing named |
| `["<a valid id>"]` | `['<a valid id>']` | ranked 1 |
| `["not-a-real-id"]` | `[]` | parsed, nothing *valid* named |
| `I cannot help with that` | `None` | could not parse |
| `` (empty) | `None` | could not parse |
| `{"ids": []}` | `None` | could not parse — an object is not a ranking |

## Fix 2 · the call is skipped when its answer would be discarded

The rerank moved below the marketplace pass, so the decision can be made with the marketplace result in hand.
On an unfiltered browse that the marketplace answered, the worker rows are either deleted by R30 §31b or shown
as a browse — and a browse belongs in SQL order (featured first, then recency) regardless.

I chose this over the simpler "skip when nothing narrowing was extracted", because that would also skip a
genuine broad-intent query the marketplace did *not* answer, which is a case where the rerank still earns its
keep.

**Measured on staging, as Anthropic calls rather than function entries:**

| Query | `rerank()` entered | reached the model |
|---|---|---|
| `רצפים סינים` | yes | no — 1 candidate, below `RERANK_MIN` |
| `חשמלאים בצפון` | yes | no — 0 candidates |
| `דיור ל-20 פועלים בחיפה` | yes | no — below `RERANK_MIN` |
| `הסעות בצפון` | yes | no — 2 candidates |
| `ביטוח לעובדים זרים` | **no** | no — skipped by fix 2 (direct hit → suppressed) |
| `השכרת ציוד` | **no** | no — skipped by fix 2 (fallback → browse) |

**Anthropic calls across the six queries: 0, down from 2.** The four that still enter `rerank()` cost nothing —
they return at the `RERANK_MIN` guard before any client is constructed.

A correction on my own measurement: the first verification counted `rerank()` *entries* and reported
"4, was 2", which reads like an increase. It was counting the wrong thing — four of those entries never reach
the network. The number that matters is model calls, and it went 2 → 0.

## Counts are unchanged by the refactor

| Query | Workers | Housing | Services |
|---|---|---|---|
| `רצפים סינים` | 1 | 0 | 0 |
| `חשמלאים בצפון` | 0 | 0 | 0 |
| `דיור ל-20 פועלים בחיפה` | 0 | 1 | 0 |
| `הסעות בצפון` | 2 | 0 | 1 |
| `ביטוח לעובדים זרים` | 0 | 0 | 1 |
| `השכרת ציוד` | 14 | 0 | 3 |

Identical to addendum 2's real-mode column, which is the point: this was a cost and observability fix, not a
behaviour change.

## The trade, recorded

A broad query whose worker rows the model *could* have ranked usefully now keeps SQL order. That is the price of
not paying for a call whose result was discarded every time it was measured. It is in the code comment at the
branch, not only here, so the next person to read it sees the decision rather than guessing at it.

---

# Addendum 5 · close-out

## The cleanup one-liner in this report was wrong. Do not reuse it.

Addendum 2 offered `DELETE FROM marketplace_reveals WHERE listing_id='3ba6303b-0a99-eddf-932a-79581d257c50';`
to remove the QA audit rows. Inspecting the table before running it showed why that would have been a mistake:

```
2026-09-22 11:45:49 | contractor  73ac1629-… | listing 3ba6303b-…   ← real, 48 days old
2026-09-27 14:08:31 | contractor  73ac1629-… | listing 94b55830-…   ← real, different listing
2026-11-09 12:55:18 | contractor  18df8bfc-… | listing 3ba6303b-…   ← QA
2026-11-09 12:55:18 | corporation 3e20211f-… | listing 3ba6303b-…   ← QA
2026-11-09 12:55:19 | corporation 9294d2f4-… | listing 3ba6303b-…   ← QA
```

**A real contractor revealed that same listing on 22 September.** The one-liner keys on `listing_id` alone, so
it would have deleted that row along with the three from this round — destroying genuine reveal history on the
word of a cleanup instruction I wrote myself.

What was actually run, scoped by timestamp:

```sql
DELETE FROM marketplace_reveals
 WHERE listing_id = '3ba6303b-0a99-eddf-932a-79581d257c50'
   AND revealed_at >= '2026-11-09 00:00:00';
```

`deleted rows: 3`, and both September rows verified still present afterwards. The table has a `revealed_at`
column, which is what makes the narrow delete possible — worth knowing, since an earlier probe in this round
guessed `created_at` and failed.

Two corrections fall out of this: it was **three** QA rows, not four (admin 401s before the insert, carrying no
entity id), and the audit table is **not** QA-only — it holds real history.

## Local fixtures removed

- 13 `r32-*` rows deleted from `marketplace_listings` on the local MySQL. The table is back to 0 rows, which is
  where it started.
- Both local ads had their `expires_at` restored to the values they had before this round
  (`2026-09-01 06:32:46` and `2026-10-31 09:09:26`). Both are in the past, so the local ads path returns nothing
  again — that is the state I found. To make them live for local testing:
  `UPDATE ads SET expires_at='2027-12-31 23:59:59' WHERE deleted_at IS NULL;`

One divergence is deliberately left in place: the local `user-org` container is running the **current repo code**,
copied in with `docker cp`, because its image predates U3 and has no `visibility.py` at all. A
`docker compose up -d --force-recreate user-org` reverts it to that stale image. See
[[project-local-stack-state]] in memory for the rest of the local environment's condition.

## Repo state

```
git rev-list --left-right --count origin/staging...origin/pivot/v2
0	0
```

Branch `pivot/v2`, everything from `pre-r32` onward pushed to both refs (`git log pre-r32..HEAD` for the list —
a count written here only goes stale the moment another commit lands). Both `cc_prompt_R32_unified_search.md`
and this report are tracked. No R32 source file is left uncommitted; the untracked files in the tree (brand icons,
`tsbuildinfo`, other rounds' prompts) were there before this round started.

The stale worktree CLAUDE.md warns about — `.claude/.claude/worktrees/reverent-agnesi-5081e9`, pinned to
`4352f1b` from 10 August — is still there. It is not mine and I have not touched it, but it is still the trap
the file describes.

## Still open, and all of them are yours

| # | Item | Why it needs you |
|---|---|---|
| 1 | Update `decision_search_visibility_19_09.md` on the project | It is not in the repo. The D1 matrix change — provider loses housing, pending contractor gains it — exists in `visibility.py`'s docstring and nowhere else. |
| 2 | Sponsor placement naming | `marketplace_banner` / `marketplace_carousel` now render on `/`, not on a marketplace page. Attribution still lands in the `marketplace` bucket, so reporting is continuous — but the names describe a page that no longer exists. Rename or accept. |
| 3 | The orange-on-white rule | `page.tsx` measures slate-900 on brand-600 at 6.93:1 and white at 2.6:1; the design-system note says brand-800 with white. Both pass AA by their own route, and both are live on different surfaces. |
| 4 | Switch the three redirects to 308 | After a week on staging. Three `permanent: false` → `true` in `next.config.js`. |
| 5 | Check the production Anthropic key | Staging's was rejected on every call until you rotated it. If production shares it, production search has been running on the regex fallback too, invisibly. |
| 6 | The pre-existing CLS spike on `/` | 0.067–0.115, intermittent, from the hero gradient and the `איך זה עובד?` row. Not S7 — S7's own A/B was 0.0009 / 0.0049, identical before and after — but at 390 it crosses the 0.1 threshold and nobody is measuring it. |
| 7 | `_search_marketplace` has no seed gate | `GET /marketplace` hides seed rows in production; the federated search pass does not. One line, but it is an R30 policy call. |

No env vars and no migrations were needed for this round. R32 added no DB columns.
