# R33 report · Admin permission fix, paid service categories, copy fix

**Date:** 15.11.2026 · **Baseline tag:** `pre-r33` (`a97f2be`) · **Branch:** `pivot/v2`, pushed to `origin/pivot/v2` and `origin/staging`

```
git rev-list --left-right --count origin/staging...origin/pivot/v2
0	0
```

## Where it stands

| Item | Status |
|---|---|
| A1 · admin actions fail with `admin_only` | **Done**, live on staging. Needs one check only you can do: your real admin user in the browser |
| B.1 · remove the provider-free bypass | **Done**, live on staging, acceptance passed |
| B.2 · a category with no paid tier cannot be picked | **Done**, live on staging |
| B.3 · a provider can add a category | **Done** for the promo period. **After the promo: stopped and reported**, there is no Cardcom charging |
| B.4 · remove the corporation subscribe page | **Done**, live on staging |
| B.5 · backfill | **Done**. Dry run and real run on staging: nothing to backfill |
| B.6 · admin clarity | **Done**, live on staging |
| C · copy fix | **Done**, live on staging |
| extra | A regression of my own from A1, on staging for about forty minutes, fixed (see below) |
| extra | R34 item 15, which R33 B unblocked, done |

**Commits**

```
d175052 R33 B.4 · the redirect rule the previous commit left out
1def6f5 R34 P1 item 15 · the provider form subtitle, now that R33 B makes it true
e9d27a1 R33 B.4 · the old subscribe URL answers with a real redirect
852a0af R33 C · "בקשות פתוחות", feminine, on the corporation import-requests page
a5c7c5a R33 B.6 · the admin screen says what a category without a plan means
4096b42 R33 B.5 · backfill: every provider listing goes on a plan, nothing disappears
96f62ad R33 B.4 · the corporation subscribe page is gone
6f9a183 R33 B.3 · a provider can add a category: /provider/marketplace/subscribe
9341fe8 R33 B.2 · a category with no paid plan cannot be picked at sign-up
dc0b3f5 R33 B.1 B.2 B.3 · a provider publishes only where it has a plan (server)
bf57d32 Fix · the public plan catalog leaves the admin prefix that A1 just closed
2164c65 R33 A1 · an admin is an admin, whichever entity they picked first
```

The server side of B.1, B.2 and B.3 is one commit: the three share one module and one test file, and splitting them
would have left commits whose tests do not pass.

---

## A1 · Admin actions fail with `admin_only`

**Root cause, confirmed.** As the prompt read it: the gateway admits an admin route on the JWT's `role`, then
projects `x-user-role = entity_type || role`. An admin who picked an entity keeps it in the token after opening the
admin area, the backend is told `corporation`, and every check written as `x_user_role == "admin"` refuses.

**Fix.**

| Change | Where |
|---|---|
| `x-user-is-admin: 1` set when the JWT's role is `admin`, deleted otherwise | `gateway/src/identityHeaders.js:46` |
| The header is in the ingress strip list, so no client can send it | `gateway/src/stripIdentityHeaders.js:26` |
| An admin-only path is decided first and is never public, whatever the method | `gateway/src/index.js:316, 317, 337` |
| One `is_admin(x_user_is_admin, x_user_role)` per service | `{user-org,deal,payment}/app/services/admin_check.py` |

`x-user-role` keeps its meaning. A caller without the flag gets, from every replaced check, exactly what it got
before.

### Blast-radius table

The prompt's list said "grep, do not trust this list". Two things the grep changed: the **payment service** was not
on the list and has five sites, and the line numbers had moved.

| Site | Before | After | Tested |
|---|---|---|---|
| **user-org** `routes/marketplace_admin.py:25` (7 routes: categories list, create, edit; tiers list, create, edit, delete) | `x_user_role != "admin"` | `is_admin(...)` | unit · local through the gateway · staging |
| `routes/contractors.py:587` kablan verify, admin skips the membership check | same | `is_admin(...)` | unit (source lock) |
| `routes/events.py:366` sponsor stats | same | `is_admin(...)` | local · staging |
| `routes/uploads.py:56` Cloudinary signature | same | `is_admin(...)` | local through the gateway · staging |
| `routes/marketplace.py:814` delete listing, admin or owner | same | `is_admin(...)` | unit (source lock) |
| `services/entity_access.py:41` (6 routes: contractor and corporation record, users, documents, uploaded file) | `x_user_role == "admin"` | `is_admin(...)` | unit · local through the gateway · staging |
| `services/team_membership.py:46` (6 routes: delete and edit member, deal contact) | `caller_role == "admin"` | `is_admin(...)` | unit |
| `services/notification_recipients.py:56` (2 routes) | same | `is_admin(...)` | unit |
| **deal** `routes/tenders.py` 15 sites: `:418` read any request, `:581 :630` bid approve and reject, `:675 :757 :873 :897 :925` owner-or-admin (select, cancel, delete, freeze, unfreeze), `:812` edit, `:952 :990` admin list and summary, `:1020` publish, `:1066` reject, `:1103` approve (confirm winner), `:1160` close | `x_user_role ==/!= "admin"` | `_is_admin(...)` | local through the gateway · staging |
| **payment** `routes/settings.py:29` update a setting | `x_user_role != "admin"` | `is_admin(...)` | local through the gateway · staging |
| `routes/payment_methods.py:125 :148 :183` owner-or-admin on one payment method | same | `is_admin(...)` | unit (source lock) |

**Left on the acting role, on purpose.** The guardrail says to stop and report when a check also serves a non-admin
path. Seven lines do, and each is pinned in a test with its reason, so none can be changed by accident:

| Site | Why it was not flipped |
|---|---|
| `user-org/services/visibility.py:93, 161, 191` | These choose **which rows a search returns** on screens an entity also uses. Flipped, an admin acting as a corporation gets the admin's view of every search and can never see what a corporation sees. Your prompt lists them in the blast radius and also says "an admin acting as a corporation in a corporation screen is a corporation there". The two pull apart here, so I left them and am asking. No admin screen depends on them. |
| `user-org/routes/search.py:575` | Same family: whether owner ids are serialised into search rows. |
| `user-org/services/search_log.py:56` | Whether a search counts as customer demand. Analytics only. |
| `payment/routes/payment_methods.py:55` | The admin branch does not bypass a check, it lists **every entity's cards** instead of the caller's own. On `/billing` an admin acting as a corporation should see that corporation's cards. |
| `deal/routes/tenders.py:228` | `create_tender`: one check for contractor and admin, and the request is filed under the acting entity's id. An admin acting as a corporation would file a request under a corporation id. |

### Evidence

**Unit and source locks.** Gateway: `test/admin-identity-header.test.js` (the projection, the strip, admin paths,
and that `index.js` still uses all three). Per service `test_admin_check.py`: the helper, and two locks over the
source: a function that reads the flag declares it as a header, and no admin gate is left on the role header outside
the table above. user-org 18 tests, deal 6, payment 6.

**End to end through the local gateway, with signed tokens** (minted inside the gateway container from its own
secret, never printed). 30 of 32 passed. The two that did not were my own wrong path for sponsor stats, a route
that turned out to be unreachable through the gateway (finding 5); its gate was then checked directly on the
service: 200 with the flag, 403 without.

```
/api/marketplace/admin/categories
  no token 401 · no token + spoofed headers 401
  admin acting as a corporation 200 · admin with no entity 200
  corporation 403 · corporation + spoofed x-user-is-admin 403 · contractor + spoofed 403
create category 201 · edit category 200 · create tier 201 · list tiers 200 · edit tier 200
  corporation edits the same tier (spoofed) 403 · delete tier 204
Cloudinary signature: admin as corporation 200 · corporation + spoofed 403 (backend, after the strip)
another org's record: admin as corporation passes the gate · corporation + spoofed 403
import requests: admin summary 200 / 403 · admin list 200 / 403
  admin publish: gate passed (404, no such request) / 403
  confirm winner: gate passed (404) / 403 · admin close: contractor + spoofed 403
payment setting: gate passed (404, no such key) / 403
x-user-role keeps its meaning: "my subscriptions" as that corporation 200,
  create request (contractor only) as that admin 403
```

**On staging**, inside each container, with the headers the new gateway sends:

```
user-org  17 of 17   categories 200 as admin-acting-as-corporation, 403 as corporation, 403 with no headers
                     create + edit category, create + edit + delete tier (temporary rows, removed)
                     another org's record 200 / 403 · sponsor stats 200 / 403 · signature 200 / 403
deal      15 of 15   admin summary, list, publish, approve, reject, bid approve: gate passed / 403
                     read any request: admin view shows contractor_id and 1 bid,
                     the same request as a corporation shows neither
payment    4 of 4    update setting: gate passed / 403
gateway (from outside)   GET /api/marketplace/admin/categories with no token: 401
                         (before A1 this reached the backend and answered 403)
                         the same with spoofed x-user-is-admin and x-user-role: 401
                         public browse (/api/marketplace, /categories): 200
```

### A1 acceptance

- [ ] **As your real admin user, after picking a corporation and then the admin tile.** Not done by me: it needs
  your login. Everything under it is verified, but this is the check that closes the item.
- [x] Admin publish and confirm-winner on an import request: the gate passes for an admin acting as a corporation
  (staging, both). **I did not run the full flow on a real request**, because publishing fans out to corporations
  and would send notifications.
- [x] Non-admin corporation: every one of those endpoints still returns 403 (staging).
- [x] A spoofed `x-user-is-admin: 1` with a non-admin token is refused (local, through the gateway, with a signed
  corporation token and a signed contractor token; on staging with no token).

### A1.4 · other admin GET paths public by method

None. `/api/marketplace/admin/*` was the only one, and it is closed. **One public route was living under that
prefix, and closing the prefix closed it too. That is the regression below.**

---

## Regression from A1 · the plan catalog, staging, about forty minutes

`GET /api/marketplace/admin/catalog` is the list of active categories and their plans. It sat in the admin router
with no admin gate and worked for the public only because GET under `/api/marketplace` is public and that rule
reached into the admin prefix. A1.4 closed that hole, as asked, and the catalog went with it: 401 for a visitor, 403
for a provider. On staging the sign-up plan picker and the listing forms had no categories.

It was mine: my A1 checks exercised the admin routes and not this one. I found it while reading the frontend client
for B, about forty minutes after the push.

**Fix** (`bf57d32`): the catalog moved to `GET /api/marketplace/subscriptions/catalog`
(`routes/marketplace_subscriptions.py:205`) and the frontend client follows. No alias is left on the old path. Two
locks so it cannot return: every route in `marketplace_admin.py` must call `_require_admin`, and the gateway test
names the catalog path as not admin-only. Confirmed on staging: the new path answers 200 with four categories, and
the sign-up page's bundle calls it.

---

## B · Service categories are paid, per category

### B.1 · the bypass is gone

`routes/marketplace.py:578` keeps the category guard (no housing, no worker). The `is_provider_free` branch is
deleted, so a provider takes the path a contractor takes: an active plan in the category, a free slot,
`subscription_id` written on the listing. No plan is `402 no_active_subscription`; a full plan is
`402 no_slots_available`. Both carry `buy_url` (`:633`), and the form shows it as a link.

**One thing changed for contractors too:** a full plan used to answer 409 and now answers 402, as your acceptance
asks. The code (`no_slots_available`) is the same and no contractor screen uses it.

### B.2 · registration

The server already required an active paid tier of the chosen category, so the "let it through" guardrail lived only
in the page. Now: the category list is the plan catalog; a category with no active paid tier is shown, marked
"אין מסלול זמין כרגע", and cannot be selected (`register/provider/page.tsx`, `lib/providerCategories.ts`).

**Added, because B makes it matter:** a provider is no longer offered **housing**, and the server refuses it
(`routes/providers.py:182`). A plan is the right to publish in its category, and a provider can never publish
housing. **Two staging providers are registered under housing** (`dee0f837…`, `064f8504…`), one holding a housing
plan that can never be used.

### B.3 · adding a category

- New page `/provider/marketplace/subscribe`: each category a provider may publish in, the plan it holds there, and
  otherwise the plans it can add at the tiers' own prices. A "הוספת קטגוריה" button on the dashboard leads to it.
- `POST /marketplace/subscriptions` answered a provider with **404 `contractor_not_found`**: the approval check sent
  every non-corporation to the contractors table. Providers have their own branch now
  (`routes/marketplace_subscriptions.py:81`).
- During the promo the purchase writes the row registration writes, through one shared function
  (`services/provider_plans.py`, called at `marketplace_subscriptions.py:364` and `providers.py:378`). Nothing is
  charged. It does not depend on `PAYMENT_FAKE_MODE`, which is off on staging.
- The confirm dialog reuses the sentence the sign-up form already has: "הפרסום ללא עלות עד 31.12.2026. לא נחייב אותך
  ללא הודעה מראש." The date comes from `site_settings.launch_promo_end` through the quote.

**After the promo: stopped, as instructed.** Cardcom charging for `marketplace_subscriptions` does not exist. Once
the promo ends, a provider's purchase answers `503 cardcom_not_configured`, as it does today for everyone else, and
the page shows that message. No payment integration was built.

### B.4 · corporation subscribe page

Page deleted, both links removed, `/corporation/marketplace/subscribe` answers 307 to `/corporation/marketplace`
(a rule in `next.config.js`; confirmed on staging). The second link sat in the empty state of "המנויים שלי" ("אין מנוי פעיל. רכוש מנוי כדי
לפרסם"). With nothing to buy that sentence is false, so the panel now shows only for a corporation that still holds
a plan.

### B.5 · backfill

`services/user-org/app/maintenance/r33_backfill_provider_plans.py`, dry run by default.

**Staging, dry run:**

```
unlinked active provider listings before: 0
launch promo ends: 2026-12-31
nothing to do: every active provider listing is already on a live plan
DRY RUN: nothing was written. Re-run with --apply to write.
```

**Staging, real run:**

```
APPLIED: 0 plan(s) created, 0 listing(s) linked
unlinked active provider listings after: 0
still off a live plan: 0 listing(s) in 0 group(s)
```

**Counts per category: zero in every category.** No provider owns a listing on staging; all sixteen listings are
seed rows advertised by corporations. Because the real run had nothing to do, the script was proven on a scratch
MySQL built from staging's table definitions, with six providers:

```
equipment   new promo plan: 1 provider, 3 listings   (3 listings on a 2-slot tier: all kept, reported as over quota)
services    new promo plan: 2 providers, 4 listings  (one of them was linked to an expired plan)
services    link to the plan it already has: 1 provider, 2 listings
other       LEFT ALONE, no active paid tier: 1 provider, 1 listing
housing     LEFT ALONE, a provider cannot publish there: 1 provider, 1 listing
applied: 3 plans created (promo_note r33_backfill, until 2026-12-31, cheapest paid tier, nothing charged), 9 linked
second run: nothing left to do · no listing disappeared · corporation housing untouched · paused listings untouched
```

**Before production, run the dry run there and read it.** Production may have provider listings; staging has none.

### B.6 · admin clarity

Header text as given. A category with no active paid tier carries "אין מסלול פעיל, ספקים לא יכולים לפרסם כאן", from a
count the category list now returns (`routes/marketplace_admin.py:104`). Nav labels: "מסלולי מנוי · קבלנים ותאגידים"
and "שירותים נלווים · קטגוריות ומחירים". The pointer line on `/admin/subscription-plans` stays; its link now names the
screen by the new label.

### B acceptance, on staging

One temporary provider, its plan and its listings, all removed afterwards. 15 of 15:

```
promo ends 2026-12-31 | cheapest services tier: 5 slots, sticker 149.00
no plan in the category: publishing is 402 no_active_subscription
the 402 links to the buy page: /provider/marketplace/subscribe?category=services
  message: אין לך מסלול פעיל בקטגוריה זו. כדי לפרסם בה יש להוסיף מסלול.
quote for a provider carries the promo end: 2026-12-31
adding a category during the promo: 201, PAYMENT_FAKE_MODE off
the plan is a promo row like registration's: launch_free_promo, until 2026-12-31, sticker 149.0
a second plan in the same category: 409 · a provider cannot buy housing: 403
with the plan: publishes, listing linked to it, slots 1/5 · slot count went down: used 1, available 4
slots exhausted: 402 no_slots_available · existing listings unaffected: 5 before, 5 after
corporation housing: 201, no plan asked for · corporation outside housing: still 403
registration under housing is refused before any write: 400
left behind (listings, providers, plans): (0, 0, 0)
active provider listings with subscription_id IS NULL: 0
```

- [x] Provider with no plan in X: 402 with a message that links to the buy page
- [x] Provider with an active promo plan in X: publishes, `subscription_id` set, slot count decreases
- [x] Slots exhausted: 402, existing listings unaffected
- [x] Corporation housing: still free, still works
- [x] Backfill dry-run counts, the real run, zero active provider listings with `subscription_id IS NULL`
- [x] **Staging categories with no active paid tier: `transport` (הסעות), and it is inactive.** The four active
  categories (housing, equipment, services, other) each have two active paid tiers.

Also: 21 unit tests (`routes/test_provider_plans.py`), and the publishing rules were run against the scratch MySQL
(same results as staging, plus the after-promo case: purchase 503, backfill writes nothing).

**Screens**, rendered locally with stubbed API data: `B3_add-category_390`, `B3_add-category_confirm_390`,
`B3_add-category_1280`, `B3_dashboard_390`, `B2_sign-up_1280`, `B6_admin-marketplace_1280`. The staging frontend was
confirmed to serve this build (each page's scripts contain the new strings and none of the removed ones).

---

## C · Copy fix

`corporation/tenders/page.tsx:119` "בקשות פתוחות להצעה" and `:123` "אין כרגע בקשות פתוחות שטרם הגשת אליהן הצעה." No
other occurrence in the frontend or in any service.

---

## What I did not verify

1. **Your real admin login** on `/admin/marketplace` after picking a corporation. The first A1 acceptance line.
2. **A full publish and confirm-winner on a real import request**, to avoid sending notifications.
3. **The new pages inside a real provider or admin session on staging.** They were rendered locally with stubbed
   data, and the API behind them was verified on staging.

---

## Findings worth a decision

1. **`visibility.py`, `search.py:575`, `payment_methods.py:55`, `tenders.py:228`** (the table above). Say the word
   and I flip any of them; each is a one-line change with its test.
2. **After the promo, registration still activates a plan without charging.** `providers.py` writes an active row
   at full price with no payment when no promo applies. Pre-existing, and it becomes real on 01.01.2027: new
   providers would get a paid plan free. It needs the Cardcom round (R34 5b) or a decision to close registration.
3. **Two staging providers hold housing** (`dee0f837…`, `064f8504…`) and cannot publish anywhere until they add a
   real category. A third (`9c7c02fd…`) has no category and no plan. They can use the new page.
4. **Corporations advertise twelve seed listings outside housing** (services 7, equipment 3, other 2), which a
   corporation may no longer publish. Seed data, untouched.
5. **`/admin/sponsor-stats` on user-org is unreachable.** The gateway sends `/api/admin/*` to the admin service, and
   no screen calls it. Its gate is fixed like the rest; the route itself is orphaned.
6. **`admin_close` answers 200 for a request id that does not exist.** It updates by id without checking.
7. **The pointer line on `/admin/subscription-plans` still hard-codes "₪149 / ₪399"**, which is now only true while
   those are the prices.
8. **The gateway rate limiter** still has no `service_provider` entry (from the R34 report), and reads the acting
   role, so an admin acting as a corporation gets the corporation ceiling.
9. **The corporation listing form still says "פרסום ללא עלות למנויים"** and the corporation listings page still
   describes "דיור, ציוד ושירותים". Both predate the housing-only rule. Not touched.

---

## `git diff -w --stat pre-r33..HEAD`

```
 ...c_prompt_R33_admin_role_and_category_billing.md |  89 ++++++
 services/deal/app/routes/tenders.py                |  51 ++--
 services/deal/app/services/admin_check.py          |  29 ++
 services/deal/app/services/test_admin_check.py     |  97 +++++++
 services/frontend/next.config.js                   |   9 +
 services/frontend/src/app/admin/layout.tsx         |   4 +-
 .../frontend/src/app/admin/marketplace/page.tsx    |  19 +-
 .../src/app/admin/subscription-plans/page.tsx      |   2 +-
 .../src/app/corporation/marketplace/new/page.tsx   |   2 +-
 .../src/app/corporation/marketplace/page.tsx       |  32 +--
 .../app/corporation/marketplace/subscribe/page.tsx | 230 ---------------
 .../frontend/src/app/corporation/tenders/page.tsx  |   4 +-
 .../frontend/src/app/provider/dashboard/page.tsx   |  12 +-
 .../src/app/provider/marketplace/new/page.tsx      |  24 +-
 .../app/provider/marketplace/subscribe/page.tsx    | 249 +++++++++++++++++
 .../frontend/src/app/register/provider/page.tsx    | 148 +++-------
 services/frontend/src/lib/api/marketplaceAdmin.ts  |   3 +
 .../src/lib/api/marketplaceSubscriptions.ts        |  12 +-
 services/frontend/src/lib/providerCategories.ts    |  28 ++
 services/gateway/src/identityHeaders.js            |  76 +++++
 services/gateway/src/index.js                      |  63 +----
 services/gateway/src/stripIdentityHeaders.js       |   3 +
 .../gateway/test/admin-identity-header.test.js     | 156 +++++++++++
 services/payment/app/routes/payment_methods.py     |  10 +-
 services/payment/app/routes/settings.py            |   4 +-
 services/payment/app/services/admin_check.py       |  29 ++
 services/payment/app/services/test_admin_check.py  |  96 +++++++
 services/user-org/app/maintenance/__init__.py      |   0
 .../app/maintenance/r33_backfill_provider_plans.py | 225 +++++++++++++++
 services/user-org/app/routes/contractors.py        |  18 +-
 services/user-org/app/routes/corporations.py       |  17 +-
 services/user-org/app/routes/events.py             |   4 +-
 services/user-org/app/routes/marketplace.py        |  65 +++--
 services/user-org/app/routes/marketplace_admin.py  | 125 ++++-----
 .../app/routes/marketplace_subscriptions.py        | 157 ++++++++++-
 services/user-org/app/routes/providers.py          |  52 ++--
 .../user-org/app/routes/test_provider_plans.py     | 308 +++++++++++++++++++++
 services/user-org/app/routes/uploads.py            |   7 +-
 services/user-org/app/services/admin_check.py      |  29 ++
 services/user-org/app/services/entity_access.py    |   4 +-
 .../app/services/notification_recipients.py        |   7 +-
 services/user-org/app/services/provider_plans.py   |  87 ++++++
 services/user-org/app/services/team_membership.py  |  13 +-
 services/user-org/app/services/test_admin_check.py | 242 ++++++++++++++++
 44 files changed, 2252 insertions(+), 589 deletions(-)
```

(This report file is added on top of that.)

---

## Manual actions

1. **Log in as your admin user, pick a corporation, open the admin tile, and check `/admin/marketplace`**: the
   category list shows, and creating and editing a category and a tier works. Then admin publish and confirm-winner
   on one import request.
2. **Add paid tiers** to every category that has none. On staging that is only `transport` (הסעות), which is also
   switched off. The new categories from R34 (ביטוח, הסעות, פיגומים, קורסים והסמכות, ציוד וכלי עבודה) need tiers and
   prices as they are added. The warning on `/admin/marketplace` shows which ones are missing.
3. **Decide the seven lines left on the acting role** (finding 1), above all whether an admin acting as a
   corporation should see what a corporation sees in search.
4. **Decide what happens to provider plans after 31.12.2026** (finding 2). Without Cardcom for marketplace
   subscriptions, a provider cannot add a category after that date, and a new provider still gets a plan without
   paying.
5. **Before production:** run `python3 -m app.maintenance.r33_backfill_provider_plans` in the user-org container,
   read the dry run, then run it with `--apply`.
6. The three staging providers without a usable plan (finding 3): leave, or tell them to add a category.
7. **R34 is unblocked.** Phase 3 (categories migration), 4b, 4c and 5a can run. Phase 3 still needs your decision
   on where the `services` and `other` listings move.
