# R34 report · Providers and copy

**Date:** 15.11.2026 · **Baseline tag:** `pre-r34` (`70ca1ea`) · **Branch:** `pivot/v2`, pushed to `origin/pivot/v2` and `origin/staging`

```
git rev-list --left-right --count origin/staging...origin/pivot/v2
0	0
```

## Where it stands

| Phase | Item | Status |
|---|---|---|
| 1 · copy | 4, 5, 6, 7, 8, 9, 11 | **Done**, live on staging |
| 1 · copy | 15 (form subtitle) | **Not done**, waits for R33 B (see below) |
| 2 · ח.פ / ע.מ check digit | 10 | **Done**, live on staging |
| 3 · categories migration | 12 | **Not run**, needs R33 A1. Counts gathered, both non-zero: needs your decision |
| 4a · form layout | 13 | **Done**, live on staging |
| 4b · category choice | 14 | **Not done**, needs R33 B (plans per category) |
| 4c · fields per category | 16 | **Not done**, needs Phase 3 (`field_schema`, `attributes`) |
| 5a · plan management | 17 | **Not done**, needs R33 B.3 |
| 5b · payment method | 17 | **Stopped and reported**, as the prompt instructs |
| 5c · numbers on the dashboard | 17 | **Done**, live on staging, acceptance passed |
| extra | search 500 | **Fixed**, a bug of mine from R32 found during this round |

**R33 was never run.** The prompt says to start R34 only after R33 is merged and deployed. There is no R33 commit on
any ref and `cc_prompt_R33_admin_role_and_category_billing.md` is still untracked. You asked to run R34 and
parallelise what can be, so I did every part that does not depend on R33 and left the rest untouched rather than
guessing at R33's design. Five items wait on it: 15, Phase 3, 4b, 4c, 5a.

**Commits**

```
1bf9861 R34 P1 item 6 · the provider sign-up page qualifies its "free" too
d4dcac1 R34 P5c item 17 · a provider can see whether anyone saw its listings
52f72c9 Fix · a search with no usable word returned 500, and it was mine from R32
a80021e R34 P4a item 13 · the provider area gets a shell, and its own listing form
6483d8d R34 P1 item 9 · the provider paragraph says "נבדק", one commit after it became true
989591d R34 P2 item 10 · a provider's ח.פ / ע.מ is now actually checked
eb57b80 R34 P1 item 11 · the "הצטרף עכשיו" section leaves how-it-works
c834305 R34 P1 item 8 · the corporation paragraph describes the check, not its plumbing
aa2d44e R34 P1 item 7 · "tier_2" leaves the public verification copy
9a237e1 R34 P1 item 6 · every registration CTA says the same thing about "free"
55ca048 R34 P1 item 5 · the provider line on how-it-works drops its end date too
45cc44f R34 P1 item 4 · "free" on the contractor button becomes "free for a trial period"
298aea2 R34 P1 item 6 · the provider dashboard stops promising "free until the end of 2026"
```

Two parts were built by parallel agents (the provider shell and form, and the analytics). I reviewed both diffs line
by line, ran their tests myself, and verified them independently before committing.

---

## Phase 1 · Copy

| # | New text | Where |
|---|---|---|
| 4 | הרשמה כקבלן · חינם לתקופת ניסיון | `how-it-works/page.tsx:163` |
| 5 | ספק שירותים? הרשמה ופרסום ללא עלות לתקופת ניסיון. | `how-it-works/page.tsx:254` |
| 6 | מודעות שפרסמת בשוק. חינם לתקופת ניסיון. | `provider/dashboard/page.tsx:132` |
| 6 | ללא דמי מנוי לתקופת ניסיון | `RegistrationCTASection.tsx:95` |
| 6 | …פרסמו את השירותים שלכם לקבלנים ולתאגידים. חינם לתקופת ניסיון. | `RoleRegisterPicker.tsx:31` |
| 6 | הצטרף עכשיו כקבלן / כתאגיד / כספק · חינם לתקופת ניסיון | `RegistrationCTASection.tsx:50, 70, 90` |
| 7 | …בעת ההרשמה. קבלנים נבדקים מחדש כל שישה חודשים. | `how-it-works/page.tsx:301` |
| 8 | נבדקים מול רשם החברות וברשימת תאגידי כוח אדם המורשים של רשות האוכלוסין וההגירה, המתעדכנת מדי שנה ממקור רשמי. תאגיד שאינו ברשימה אינו יכול לפרסם. | `how-it-works/page.tsx:307` |
| 9 | נבדק עוסק מורשה או ח.פ. (shipped one commit after Phase 2) | `how-it-works/page.tsx:313` |
| 11 | the `aria-label="הרשמה"` section and its comment block removed | `how-it-works/page.tsx` |

Changed by the grep, beyond the listed lines (same pattern, user-facing):

- `how-it-works/page.tsx:213, 262` · the corporation and provider buttons on the same page, so the three match.
- `RoleRegisterPicker.tsx:65` · "הרשמה חינם →" became "הרשמה · חינם לתקופת ניסיון →".
- `register/provider/page.tsx:372` · "הרישום חינם." became "הרישום חינם לתקופת ניסיון." (found late, commit `1bf9861`).

**Evidence.** `grep -rn "סוף 2026" services/frontend/src services/notification/src services/user-org/app` returns
**0 lines**. The how-it-works strings and the home role cards were read back from staging after deploy. Screenshots,
before and after at 390 and 1280: `P1_how-it-works_*`, `P1_home-register_*` (8 files, sent on 15.11).

**Remaining hits, left unchanged, yours to decide:**

1. `features/advertising/RevealModal.tsx:163, 172` · "חפשו אצלנו בחינם…" and "הרשם כקבלן — 14 יום חינם". This is a
   specific 14-day trial claim, not the end-of-2026 wording, so I did not rewrite it.
2. `register/provider/page.tsx:590` · "הפרסום ללא עלות עד DD.MM.YYYY. לא נחייב אותך ללא הודעה מראש." The date comes
   from `NEXT_PUBLIC_FREE_LAUNCH_UNTIL` and the sentence was added in R30 §8 on purpose, so that a provider knows when
   billing starts. `FreeLaunchBanner` reads the same variable. It is the same promise with a date instead of words.
3. Provider welcome email, `notification/src/consumers/handlers.js:270` · promo block dated from
   `site_settings.launch_promo_end` (2026-12-31 on staging).

**Two things the prompt assumed that the code does not match:**

- **Item 11.** The stated reason was that registration stays reachable from the nav's "הצטרף עכשיו". The how-it-works
  page has its own two-link nav with no such button. Registration is still reachable from the three role buttons on
  the page, so nothing is stranded, but the nav button does not exist there.
- **Item 7.** "קבלנים נבדקים מחדש כל שישה חודשים" is broader than what runs. The revalidation job covers only tier_2
  contractors verified through registry email or SMS; manually approved contractors are skipped. The text is as you
  wrote it. If the claim should be exactly true, either the job or the sentence needs to move.

---

## Phase 2 · ח.פ / ע.מ check digit (item 10)

| Change | Where |
|---|---|
| `check_business_number(raw) -> (canonical, error_code)`: required, 8 or 9 digits, check digit, canonical 9-digit form | `integrations/israeli_id.py:39` |
| All zeros rejected. `000000000` passes the arithmetic (0 mod 10 is 0) and was accepted for **all three entity types** | `integrations/israeli_id.py:16` |
| Provider registration uses it, with three distinct errors | `routes/providers.py:120` |
| Duplicate guard matches every spelling of the number (with and without leading zeros), across providers, contractors and corporations | `routes/providers.py:142` |
| Client check on blur and on submit, same rules, sends the canonical value | `lib/businessNumber.ts:44`, `register/provider/page.tsx:282, 643` |
| Hebrew message for `invalid_business_number` | `lib/api/errors.ts:92` |

Messages: "ח.פ / ע.מ הוא שדה חובה" · "ח.פ / ע.מ חייב להיות 9 ספרות" · "מספר ח.פ / ע.מ אינו תקין. בדקו את הספרות."

**Evidence.** 17 server tests (`integrations/test_israeli_id.py`) and 14 mirrored client tests
(`tests/businessNumber.test.mjs`), all passing. On staging, five invalid numbers sent to
`POST /organizations/providers/register` were each refused with the right code before any database write.

**Phase 2 failure count: 2 of 4.** Staging has four providers. Two fail the new check:

| Provider id | Why |
|---|---|
| `9c7c02fd…` | six digits, wrong format |
| `f47f2a82…` | nine digits, wrong check digit |

Both are active and not seed rows. **Nobody was deactivated or edited.** The check runs at registration only, so they
keep working. What to do with them is a manual action below.

**2.3 · registry lookup, not built.** `data_gov_il.lookup()` already queries the companies registry with a 7-day
cache and would work for ח.פ companies. It cannot cover ע.מ sole proprietors, who are not in that registry, and
`service_providers` has no columns for a registry snapshot. So the public claim (item 9) is true as "format and check
digit", not as "found in a registry".

---

## Phase 3 · Categories migration (item 12) · not run

It needs R33 A1. I only read staging, to give you the numbers the prompt asks for:

| Category | Listings | Active subscriptions | Tiers |
|---|---|---|---|
| housing (דיור להשכרה) | 4 | 1 | 2 |
| equipment | 3 | 0 | 2 |
| **services** | **7** (transport 4, insurance 3) | **1** | 2 |
| **other** | **2** (both courses) | **0** | 2 |

**Both `services` and `other` are non-zero, so by the prompt's own rule Phase 3 stops here for your decision** on
where those nine listings and the one subscription move. All twelve non-housing listings are seed rows advertised by
corporations.

Facts that will matter when it runs: `marketplace_categories` has no `search_synonyms` and no `field_schema`;
`marketplace_listings` has no `attributes`; an inactive `transport` (הסעות) category already exists with zero tiers.

---

## Phase 4 · Provider listing form

### 4a · Layout (item 13) · done

| Change | Where |
|---|---|
| Provider area shell: sticky top bar with the business name, nav (לוח בקרה, המודעות שלי, יציאה), mobile menu with `aria-expanded`, Esc closes and returns focus | `components/provider/ProviderShell.tsx` (new) |
| Shell mounted for every `/provider/*` page, inside the role guard | `provider/layout.tsx:11` |
| The provider form is its own page, no longer a re-export of the corporation form. `max-w-2xl`, paired fields on one row from `sm` up (city + region, price + unit, capacity + available from, contact name + phone) | `provider/marketplace/new/page.tsx:59` |
| `housing` is not offered to a provider and `?category=housing` is ignored | `provider/marketplace/new/page.tsx:35, 80` |
| The corporation form lost its provider branches and is housing-only, as before | `corporation/marketplace/new/page.tsx` |

**Evidence.** Rendered locally at 390 and 1280 with stubbed API data: `P4a_provider-dashboard_*`,
`P4a_provider-form_*` (4 files). No horizontal scroll at either width.

**Not in the nav on purpose:** "מנוי ותשלום". The page it would open is 5a, which does not exist yet. A link to
nothing is worse than no link. It is one line to add when 5a lands.

### 4b (item 14) and 4c (item 16) · not done

4b needs to know which categories a provider has a plan in, which is R33 B. 4c needs `field_schema` and
`attributes` from Phase 3. Item 15's subtitle ("המודעה נכללת במסלול שלך בקטגוריה") describes a plan that does not
exist until R33 B, so the current subtitle stays until then.

---

## Phase 5 · Provider area

### 5a · Plan management · not done (needs R33 B.3)

### 5b · Payment method · stopped, as instructed

**Cardcom tokenization and charging for `marketplace_subscriptions` does not exist.**
`POST /marketplace/subscriptions` activates a subscription only under `PAYMENT_FAKE_MODE` with a `FAKE-…` token;
otherwise it answers 503 `cardcom_not_configured`. The payment service's Cardcom flows (token add and replace,
invoices, what `/billing` shows) serve only the contractor and corporation `subscriptions` table. There is no
reusable payment-method component that could be pointed at a provider without building the integration behind it.
Nothing was built.

### 5c · Numbers on the provider dashboard · done

**1 · Events.** Same pipeline, same gates.

| Change | Where |
|---|---|
| Allow-list keyed by target type: `sponsor_ad` keeps `impression / ad_click / inquiry`, `marketplace_listing` gets `listing_impression / listing_open`. A crossed pair is refused | `routes/events.py:79, 124` |
| Liveness against the right table: an active, undeleted listing | `routes/events.py:128` |
| Listing events are stored with NULL actor columns | `routes/events.py:154` |
| Card impression: half on screen for one second, once per page view, the sponsor rule | `ListingCard.tsx:58`, `hooks/useAdImpression.ts` |
| Panel open, once per listing per page view, sent when the listing has loaded | `ListingDetailPanel.tsx:106` |
| Listing events wait 2 s to leave as one request; a sponsor impression still pulls the flush to 300 ms | `lib/adEvents.ts:120` |

`contact_reveal` is **not** an event. The reveal endpoint already writes `marketplace_reveals`, one row per viewer
and listing, and the dashboard reads reveals from there. That is the "do not double count" in the prompt.

**2 · Search log.** Migration `097_r34_search_log.sql` adds `search_log`: one row per search with the category codes
of the listings it matched (JSON array), the region the rewriter extracted, the caller's role, and whether the OR
fallback produced the match. **No query text, no user id, no entity id.** The write is a background task after the
response and swallows its own failures (`services/search_log.py:80`, `routes/search.py:712`). Ranking and the
response body are untouched.

**3 · Dashboard.** `GET /api/organizations/providers/me/stats?days=30|7` (`routes/provider_stats.py`, mounted at
`main.py:55`). Four tiles (חשיפות, כניסות למודעה, פניות לפרטי קשר, חיפושים בתחום שלך), one trend line of impressions
per day, a per-listing table, a 30 / 7 day toggle, and a line that says what the search number was counted over.
Hand-drawn SVG, no chart library, no new dependency (`components/provider/ProviderStats.tsx`, mounted at
`provider/dashboard/page.tsx:126`).

**4 · Privacy.** The provider is whoever the gateway says the caller is. No path segment or parameter names a
provider, so no request can ask for somebody else's numbers. Only counts leave the endpoint. Searches made by
providers and admins are left out of the demand number.

**Evidence**

- 58 new unit tests (`test_events.py`, `test_provider_stats.py`, `test_search_log.py`), all passing, alongside the
  existing suites (92 passed in the run that included search and the check digit; 91 frontend tests passed).
- **Against a real MySQL, with staging's own table definitions** (scratch database, dropped afterwards): the
  migration applies twice without error; the handlers refuse crossed pairs, an unknown listing, a paused listing and
  a listing id filed as an ad; the endpoint's numbers equal direct `COUNT(*)` queries per listing for both windows;
  a second provider's answer contains no id of the first provider, its listings, or any viewer.
- **Acceptance P5 on staging**, with one temporary provider and one temporary listing, both removed afterwards:

```
097 in ledger: ['097_r34_search_log.sql']          search_log table: True
real browser, anonymous, search "הסעות":           POST /api/events/batch -> 204 (x4)
listing_impression 5   with an actor: 0
listing_open       1   with an actor: 0
search_log row:  ["services"]  region None  viewer None  via_fallback 0
reveal as a corporation: 200      reveal by the owner itself: 200
stats 30d: endpoint {impressions 1, opens 1, reveals 1} | direct SQL {1, 1, 1} | match True
stats  7d: endpoint {impressions 1, opens 1, reveals 1} | direct SQL {1, 1, 1} | match True
marketplace_reveals for the listing: corporation 1, service_provider 1 (the owner's own, not counted)
promo_events with a reveal event type: 0
second provider: 200, 0 listings, the test listing's id and provider id are not in its answer
contractor: 403 · corporation sending the provider's id: 403 · no headers: 403
unknown provider id: 404 · days=14: 400 · through the public gateway with no session: 401
```

- Screenshots: `p5c_stats_390_top`, `p5c_stats_390_table`, `p5c_stats_390_error`, `p5c_stats_1280` (local, stubbed
  data). The 30 / 7 toggle, the error state with retry, and the "no impressions yet" state were exercised.

**What I did not verify.** I did not see the stats block, the shell or the form inside a real provider session on
staging: that needs a provider login, and creating an account is not something I do without being asked. They were
rendered locally with stubbed API responses, and the API behind them was verified on staging. The owner-is-not-counted
rule for cards and panels is covered by reading the code, not by a browser run.

**Left on staging from the acceptance run:** four `listing_impression` rows for real seed listings and two
`search_log` rows. They are genuine anonymous telemetry from my browser session, no identity in them. The temporary
provider and listing, their two events and their two reveal rows were deleted.

---

## Fix outside the list · search returned 500 on a query with no usable word

`POST /api/search` with `!!`, `??`, `...` or `,,` returned HTTP 500 on staging since 9 Nov. The cause was mine, from
R32: `_search_marketplace` had an early `return []` while its caller unpacks two values. Fixed in `52f72c9`
(`routes/search.py:350`, now `return [], False`) with three regression tests, and confirmed on staging: `!!` now
returns 200. It was found by the analytics agent while reading the function.

---

## Findings worth a decision

1. **Gateway rate limit has no `service_provider` entry** (`gateway/src/rateLimit.js:29`). A logged-in provider falls
   through to the anonymous ceiling, 60 requests a minute, instead of the 200 a contractor or corporation gets. It is
   a numeric abuse-control default, so I did not change it.
2. **The 16 KiB body cap named in `events.py` was never implemented**, before or after this round. The prompt lists
   "size cap" among the gates. What actually bounds a request is the 20-event batch cap and the per-field length
   limits. A real byte cap belongs at the gateway, which today proxies bodies of any size.
3. **A listing stored with `region='national'` is skipped by a regional search** (`routes/search.py:365` matches the
   region or NULL only), while the dashboard counts it as nationwide. The provider form's region is still free text;
   4c replaces it. One line in the search would close it, but the prompt says not to touch the search.
4. **A provider's listing is labelled "פורסם על ידי · תאגיד" in the detail panel.** Seen on staging with the test
   listing. The panel uses that label for every advertiser.
5. **An owner who finds their own card through search is counted as a view.** Search results never carry the contact
   fields that identify the owner. The owner's reveals are excluded; their own impressions and opens through search
   are not.
6. **A "day" is a UTC day.** The window uses the database's `CURDATE()`, so the day turns over at 02:00 or 03:00
   Israel time. It keeps the series and the totals exactly consistent; say the word if it should be Israel time.
7. **Searches matched only by the OR fallback count as demand.** The flag is stored per row (`via_fallback`), so the
   choice can change later without losing history.
8. 4a: the business name shows twice on the dashboard (shell bar and page header), and
   `/organizations/providers/me` is fetched twice (shell and page). Cosmetic, left as is.
9. The provider dashboard's own listing cards show the raw status word (`paused`) in English. Not from this round.

---

## `git diff -w --stat pre-r34..HEAD`

```
 db/migrations/097_r34_search_log.sql               |  51 +++
 .../cc-prompts/cc_prompt_R34_providers_and_copy.md | 140 ++++++++
 .../src/app/corporation/marketplace/new/page.tsx   |  59 ++--
 services/frontend/src/app/how-it-works/page.tsx    |  51 +--
 .../frontend/src/app/provider/dashboard/page.tsx   |  15 +-
 services/frontend/src/app/provider/layout.tsx      |  11 +-
 .../src/app/provider/marketplace/new/page.tsx      | 293 ++++++++++++++++-
 .../frontend/src/app/register/provider/page.tsx    |  35 +-
 .../components/landing/RegistrationCTASection.tsx  |   8 +-
 .../src/components/marketplace/ListingCard.tsx     |  20 ++
 .../components/marketplace/ListingDetailPanel.tsx  |  32 +-
 .../src/components/provider/ProviderShell.tsx      | 201 ++++++++++++
 .../src/components/provider/ProviderStats.tsx      | 359 +++++++++++++++++++++
 .../features/advertising/RoleRegisterPicker.tsx    |   4 +-
 services/frontend/src/hooks/useAdImpression.ts     |  22 +-
 services/frontend/src/lib/adEvents.ts              |  50 ++-
 services/frontend/src/lib/api/errors.ts            |   2 +-
 services/frontend/src/lib/api/providerStats.ts     |  68 ++++
 services/frontend/src/lib/businessNumber.ts        |  56 ++++
 services/frontend/tests/businessNumber.test.mjs    | 113 +++++++
 services/user-org/app/integrations/israeli_id.py   |  41 ++-
 .../user-org/app/integrations/test_israeli_id.py   | 100 ++++++
 services/user-org/app/main.py                      |   6 +-
 services/user-org/app/routes/events.py             |  94 ++++--
 services/user-org/app/routes/provider_stats.py     | 314 ++++++++++++++++++
 services/user-org/app/routes/providers.py          |  56 +++-
 services/user-org/app/routes/search.py             |  23 +-
 services/user-org/app/routes/test_events.py        | 233 +++++++++++++
 .../user-org/app/routes/test_provider_stats.py     | 313 ++++++++++++++++++
 services/user-org/app/routes/test_search.py        |  31 ++
 services/user-org/app/services/search_log.py       | 102 ++++++
 services/user-org/app/services/test_search_log.py  | 125 +++++++
 32 files changed, 2867 insertions(+), 161 deletions(-)
```

(This report file is added on top of that.)

---

## Manual actions

From the prompt:

1. Add tiers and prices for ביטוח, הסעות, פיגומים, קורסים והסמכות, ציוד וכלי עבודה in `/admin/marketplace`. Nothing was
   invented: no price, no plan size.
2. Decide where the `services` listings (7, plus 1 active subscription) and the `other` listings (2) move. Phase 3
   cannot run until you do.
3. Review the transport and scaffolding fields with one real provider each. They are not built yet (4c).

From this round:

4. **Run R33**, or tell me to. It gates item 15, Phase 3, 4b, 4c and 5a.
5. Decide what happens to the two existing staging providers whose number fails the check (`9c7c02fd…`,
   `f47f2a82…`): leave, ask them to correct it, or deactivate.
6. Decide on the three remaining "free" texts listed under Phase 1, and whether the dated promo sentence
   (`NEXT_PUBLIC_FREE_LAUNCH_UNTIL`, `site_settings.launch_promo_end`) should also become "לתקופת ניסיון".
7. Decide whether item 7's sentence should be made exactly true (revalidate manually approved contractors too) or
   narrowed.
8. Decide on a rate limit for `service_provider` at the gateway (finding 1).
9. 5b: Cardcom for marketplace subscriptions is a round of its own. Until it exists, a provider cannot pay.
10. Untracked prompt files I was not given to run and did not add: `cc_prompt_R32_accumulating.md`,
    `cc_prompt_R33_admin_role_and_category_billing.md`, `prod_env_hardening_0928.md`, `status_0927.md`.
