# R37 report · 15.11.2026

Branch `pivot/v2`, deployed to staging. `git rev-list --left-right --count origin/staging...origin/pivot/v2` = `0	0`.
Tag `pre-r37` is at `1de4bc3`, the last R33 commit. 27 commits since, 78 files.

## What to know first

1. **Parts 0, 1, 2, 3, 5 and 6 are done and live on staging.** Part 4 is done only in part, see the next point.
2. **Part 4 (Cardcom) stopped at 4.1, on a contradiction.** The prompt builds on "token add and replace through
   LowProfile" and "the same card block `/billing` uses". Neither exists. No code anywhere creates a Cardcom card page,
   `/billing` has no card UI, and nothing ever calls the refund function. **That premise came from my R34 report, which
   overstated what exists.** I did 4.0 (the webhook route) and 4.1.3 (no plan without a charge at registration), reported
   4.1.4 and 4.1.7, and stopped the rest for your go-ahead. Details and what I need from you are under Part 4.
3. **Two facts about staging's payment service that the prompt assumes otherwise:** `PAYMENT_FAKE_MODE` is **on** there
   (it is off in user-org), and the Cardcom terminal number is set to something that is **not** the public test terminal.
   I did not read the value. Please confirm it is a test terminal before fake mode is ever switched off.
4. **One of your decisions could not be applied as written.** D7 says the one plan on `services` "moves with its
   owner's listings". Its owner has no listings. I left that plan and the `services` category alone. One answer from you
   closes it (Manual action 2).
5. **Every promo plan ends on 31.12.2026 and nothing happens when a plan ends.** No job flips its status and its
   listings stay published. This is not new, but it now has a date. It belongs to the renewal work in Part 4.

## Status

| Part | Item | Status |
|---|---|---|
| 0 | Prompt files tracked | Done |
| 1 | Copy: D1, D2, corporation pages, admin pointer | Done, live |
| 2 | R36 operating company | Done, live |
| 3.1 | R34 Phase 3 categories (D4, D7) | Done, live. `services` left on, see finding 1 |
| 3.2 | R34 4b category choice | Done, live |
| 3.3 | R34 4c fields per category | Done, live |
| 3.4 | R34 5a plan management | Done, live |
| 4.0 | Cardcom webhook route | Done, live |
| 4.1.1 | Card for a provider | **Stopped**, nothing to extend |
| 4.1.2 | Charge on purchase | **Stopped**, needs 4.1.1 |
| 4.1.3 | Registration after the promo | Done, live |
| 4.1.4 | Renewal | **Reported**: the job and its rules exist for contractors and corporations; not extended |
| 4.1.5 | Refund | **Stopped**, needs a charge to refund |
| 4.1.6 | Webhook verification | The existing handler already verifies; nothing new to verify yet |
| 4.1.7 | VAT | **Reported**: tier price is VAT included |
| 5 | Eight small fixes | Done, live |
| 6 | R35 WhatsApp on Meta | Code done, live. Nothing has met Meta yet; needs your secrets |

Order: 4b and 5a were in progress when R37 arrived, so they were finished first and Parts 0 to 2 followed. Part 6 was
written by a subagent in parallel with Parts 2 to 5; I reviewed it, ran its tests and its SQL, and committed it last.

## Commits

```
4b97513 R37 Part 5 item 6 · the route is /tenders/{id}/admin/close
66a0888 R37 4.1.3 · after the promo, registration activates no plan
d6fd4e0 R35 §5 · the WhatsApp variables and where they go
bda8170 R35 §1 §2 §4 · WhatsApp on Meta's Cloud API: a message in, a search, one reply
ebf0cea R35 §3 · WhatsApp message ids are unique, and wide enough for Meta's
b9a737e R37 Part 5 item 8 · a day on the provider's dashboard is a day in Israel
af9c458 R37 Part 5 item 7 · a logged-in owner's own views are not counted
4d3c4de R37 Part 5 item 6 · admin_close answers 404 for a request that does not exist
7aba142 R37 Part 5 item 5 · the provider's name once, its profile fetched once
1fb2ca5 R37 Part 5 item 3 · a provider's listing is "פורסם על ידי · ספק שירות"
ae51336 R37 Part 5 item 1 · a service provider gets the contractor and corporation rate limit
14c8e8d R37 4.0 · Cardcom's recurring-charge webhook reaches the payment service
0e7f306 The listing panel opens after a link followed inside the app
3f8f523 R34 4c item 16 · the listing form asks the category's questions; the panel shows the answers
ef82305 R34 4c item 16 · each category asks its own questions (server and data)
5d8b32f R34 Phase 3 item 12 · the site knows the six categories by name, icon and colour
737cd64 R34 Phase 3 item 12 · the marketplace categories match our list (data)
b2eac2c R36 · the site names its operator: אג'נטיק טכנולוגיות בע"מ, ח.פ 517362620
9af958d R37 Part 1 · the admin pointer line reads the provider plan prices instead of quoting them
163c1fb R37 Part 1 · the corporation's listing pages say housing, which is all it publishes
5a3e6c7 R37 Part 1 D2 · no promise of periodic re-checks
37567f2 R37 Part 1 D1 · what is free is free "לתקופת ניסיון", with no date and no day count
acc39b5 R37 Part 0 · the prompt files that were still untracked
acfd8bf R34 4b item 14 · the listing form offers only categories with a plan
5c6f0a1 R34 5a · "מנוי ותשלום": a provider's plans, per category
cef6f10 R34 5a · a plan's owner can upgrade it, cancel it and switch renewal on (server)
```

Migrations added, all applied on staging (ledger checked): `098` email footer, `099` WhatsApp ids, `100` operating
company, `101` categories, `102` listing fields.

Two errors in commit messages, both mine: `cef6f10` says "35 new tests", the file has 31. `4d3c4de` names the route
`admin-close`; it is `admin/close` (corrected in `4b97513`).

---

## Part 0 · Housekeeping

Tracked in one commit: `cc_prompt_R32_accumulating.md`, `cc_prompt_R35_whatsapp_meta.md`,
`cc_prompt_R36_operating_company.md`, `cc_prompt_R37_close_open_items.md`, and your edit of
`cc_prompt_R34_providers_and_copy.md` (Phase 3 item 2). `cc_prompt_R33…` was already tracked.

Left untracked as instructed: `prod_env_hardening_0928.md`, `status_0927.md`.

Not touched, listed as asked: 17 entries under `docs/12_worker_images/` (12 deleted PNGs, 5 untracked files and
folders). Also untouched and not mine: `docs/cc-prompts/cc_prompt_whatsapp_meta_W1.md` (modified),
`docs/accessibility_plan_il.md`, `tools/screens-export/*`, `worktree`, `docs/Logo/`, `docs/legal/`, `docs/migration/`,
`marketing-screenshots/`, `Claude outputs/`, `env-gap.json`.

## Part 1 · Copy

| Where | Now |
|---|---|
| `RevealModal.tsx:163` | חפשו אצלנו בחינם. חשיפת פרטי הקשר של תאגידים דורשת חשבון עם מנוי פעיל. המנוי חינם לתקופת ניסיון. |
| `RevealModal.tsx:172` | הרשמה כקבלן · חינם לתקופת ניסיון |
| `register/provider/page.tsx` | הפרסום ללא עלות לתקופת ניסיון. לא נחייב אותך ללא הודעה מראש. |
| Subscribe dialog | the same sentence |
| `FreeLaunchBanner.tsx` | תקופת ניסיון · לא ייגבה חיוב. עסקאות מאושרות בלי תשלום במהלך התקופה. |
| Provider welcome email, `handlers.js` | הפרסום שלך ללא עלות לתקופת ניסיון. לא נחייב אותך ללא הודעה מראש. |
| `how-it-works/page.tsx:301` | the six-months sentence is gone; the two before it stand |
| Corporation form subtitle | פרסום דיור לעובדים במסגרת המנוי שלך |
| Corporation listings page | ניהול פרסומים בשירותים נלווים · דיור לעובדים |
| `/admin/subscription-plans` pointer | distinct prices of active paid provider tiers, read from the catalog; no number in code |

The variables are untouched: `NEXT_PUBLIC_FREE_LAUNCH_UNTIL`, `FREE_LAUNCH_UNTIL` and `site_settings.launch_promo_end`
still decide whether each text shows and when billing starts. One behaviour change: the registration sentence used to
show for any readable date, past ones included. With no date in it, that would read as a standing promise, so it now
hides once the date has passed, the test the banner already applied.

**D2, one place beyond the table.** The same promise closes the email a contractor gets on verification (template
`contractor.verified`): "האימות תקף לחצי שנה. נבדוק את הרישום שלך בפנקס באופן תקופתי, ונודיע לך מראש אם יידרש לחדש."
Your decision says no sentence about periodic re-checks, so migration `098` removes that footer paragraph, in Hebrew and
English, and nothing else. Say so if you want it back. The revalidation job and the email it sends when a registration
lapses are untouched.

**Grep** `חינם|ללא עלות|בחינם` over frontend, notification, user-org: 22 hits, none of them in user-org. 18 lines
say "לתקופת ניסיון". The phrases that stay, and why:

| Hit | Why it stays |
|---|---|
| `how-it-works:151` "גלישה במודעות היא ללא עלות" | a product fact, not a promo |
| `RevealModal:163` "חפשו אצלנו בחינם" | the same |
| `page.tsx:142, 147` "ניסיון חינם" | a plan badge, no date and no day count |
| `MarketplacePreview:116` "מפרסמים ללא עלות נוספת" | corporation housing is included in the licence |

A second grep for day counts and dates (`14 יום`, `ימי ניסיון`, `31.12`) finds only the admin field label
"ימי ניסיון ברירת מחדל" and a code comment.

**Evidence.** Staging frontend checked page by page for the new strings and against the old ones: all present, none of
the old left, except the banner, see finding 4. Screenshots: `P1_subscribe-dialog_390/1280`,
`P1_corporation-form_390/1280`, `P1_how-it-works_verification_390/1280`.

**Not taken:** the reveal modal and the registration sentence. An anonymous visitor does not see worker ads, so I could
not reach the modal's signed-out state without a login. The registration sentence does not render on staging at all
(finding 4). Both texts are confirmed in the deployed bundle.

## Part 2 · R36 · Operating company

`אג'נטיק טכנולוגיות בע"מ · ח.פ 517362620` on `/contact` (with "עודכן לאחרונה" moved to 15.11.2026), in the landing
footer, and in the closing paragraph of `/how-it-works`. The address line on `/contact` was already the registered one.

Stored content, migration `100`, before and after (the changed sentences only):

| Document | Before | After |
|---|---|---|
| terms, v3 → v4 | מופעלת על ידי **Lead Agentic** (עוסק מורשה 032340283), רבי יוסף בוכריץ 6… | מופעלת על ידי **אג'נטיק טכנולוגיות בע"מ** (ח.פ 517362620), רבי יוסף בוכריץ 6… |
| privacy, v1 → v2 | נאסף ומעובד על ידי **Lead Agentic** (עוסק מורשה 032340283), רבי יוסף בוכריץ 6… | נאסף ומעובד על ידי **אג'נטיק טכנולוגיות בע"מ** (ח.פ 517362620), רבי יוסף בוכריץ 6… |
| accessibility | names no operator in its stored body | unchanged |

The third of the "3 mentions" is `site_settings.company_legal_name`. It is updated, and `company_number` and
`company_address`, which were NULL, are filled. The migration goes the way a save from `/admin/legal` goes: the old
body is in `legal_document_history`, the version is bumped, `updated_by` is `migration_100`. A value an admin typed is
never overwritten. Run twice on a scratch copy: the second run changes nothing. Confirmed on staging through the
public API (`/api/legal/terms` v4, `/api/legal/privacy` v2).

Grep of the services for `Lead Agentic|032340283|עוסק מורשה`: one hit left, `how-it-works:313` "נבדק עוסק מורשה או ח.פ",
which is about a provider's number, not the operator.

Left as they are: the mailbox `yulian@leadagentic.net`, migration `074`, old prompt and report files,
`scripts/smoke_test.py` (a domain in a list). `docs/RAILWAY_SECRETS_CHECKLIST.md` names only the mailbox.

Three of the listed documents are **untracked** working files of yours. I edited them in place and they stay
untracked: `docs/accessibility_statement.md`, `docs/whatsapp_setup_guide.md`, `docs/meta_verification_checklist.md`.
In the last one I changed the header and added a dated note; the August diagnosis below it is history and I left it.

Screenshots: `P2_contact_390/1280`, `P2_home-footer_1280`, `P1_how-it-works_verification_*`. The legal pages render
database content that the local stack does not have, so for those the evidence is the API response above, not a
picture. Both documents are still marked draft (`is_draft`), as they were.

## Part 3 · Categories, form, plan management

### 3.1 · Categories (R34 Phase 3, D4, D7)

Migration `101`, as applied on staging:

| Order | Code | Name | Active | Listings | Active paid tiers |
|---|---|---|---|---|---|
| 10 | insurance | ביטוח | yes | 3 | בסיסי · 5 ads · 30 days · ₪200 |
| 20 | transport | הסעות | yes | 4 | בסיסי · 5 · 30 · ₪200 |
| 30 | housing | דיור לעובדים | yes | 4 | ₪199 (5), ₪499 (20), unchanged |
| 40 | equipment | ציוד וכלי עבודה | yes | 3 | ₪149 (5), ₪399 (20), unchanged |
| 50 | scaffolding | פיגומים | yes | 0 | בסיסי · 5 · 30 · ₪200 |
| 60 | courses | קורסים והסמכות | yes | 2 | בסיסי · 5 · 30 · ₪200 |
| 90 | services | שירותים | **yes** | 0 | ₪149, ₪399 (old) |
| 100 | other | כללי | no | 0 | (old tiers, hidden with the category) |

**D7 mapping, row by row** (all nine are seed rows; only `is_seed` rows are moved by the migration):

| Listing | From | To |
|---|---|---|
| ביטוח רפואי לעובדים זרים | services / insurance | insurance |
| ביטוח תאונות עבודה וצד ג׳ | services / insurance | insurance |
| חבילת ביטוח משולבת לתאגידים | services / insurance | insurance |
| הסעות יומיות לאתרי בנייה | services / transport | transport |
| הסעות לאתרים מרוחקים, כולל סופ״ש | services / transport | transport |
| הסעת עובדים בוקר וערב, קו קבוע | services / transport | transport |
| שירות הסעות גמיש לפי דרישה | services / transport | transport |
| קורס בטיחות בגובה | other | courses |
| קורס עברית בסיסית לעובדים | other | courses |

Three things that differ from the prompt:

1. **`services` is still on.** See finding 1.
2. **Equipment got no ₪200 tier.** Its tiers on staging are ₪149 and ₪399, not ₪199 and ₪499 (those are housing's).
   A second 5-ad tier at ₪200 beside the 5-ad tier at ₪149 is a plan nobody would pick, so I left it for you to set.
   The migration's rule is "a provider category with no active paid tier gets one", which equipment does not need.
3. **No `search_synonyms` column exists**, so item 4 stops at the list, as the prompt says.

**The six chips on staging, anonymous search:**

| Chip | Sends | Listings returned |
|---|---|---|
| ביטוח | ביטוח | 4 (3 insurance, 1 transport that mentions it) |
| הסעות | הסע | 4 transport |
| דיור לעובדים | מגורים | 1 transport; housing itself is hidden from an anonymous visitor (R32 D1) |
| ציוד וכלי עבודה | כלי | 3 equipment |
| פיגומים | פיגומים | 1, filed under equipment (finding 3) |
| קורסים והסמכות | קורס | 2 courses |

Also: the seed script wrote the same rows under the old categories; it now seeds them where `101` puts them. The site
knows the six by name, icon and colour (`lib/categoryStyle.ts`); a listing in a new category used to show its code, a
generic icon and a grey bar. A new tier in `/admin/marketplace` starts with ₪200 in the price field (D4).

### 3.2 · 4b · Category choice

The picker is the provider's running plans. One plan: a fixed chip. Other open categories are listed as locked, each
with "הוספת מסלול בקטגוריה". Housing is never offered and `?category=housing` is dropped; so is a hint for a category
the provider has no plan in. A full plan disables the button and links to "מנוי ותשלום". No plan at all: one sentence
and a button instead of a form. The hard-coded fallback list is gone.

Screenshots: `P3_4b_form_two-plans_390/1280`, `P3_4b_form_one-plan-full_390`.

### 3.3 · 4c · Fields per category

Migration `102` adds `marketplace_categories.field_schema`, `marketplace_listings.attributes` and
`marketplace_listings.regions`, and seeds the five schemas from your list, key for key (a test reads them from the
migration file and compares). The server validates a listing's answers against its category's schema: types, required
fields, option lists, a price with its unit, and no key the schema does not name.

Choices I made that you should know about:

- **Nothing is marked required**, because the list does not say which fields are. The one rule it states is kept:
  equipment needs at least one of its three prices. Marking a field required is one flag in the data.
- **Language options** ("from the origins' languages"): עברית, אנגלית, רוסית, and the main language of each origin
  country active today (סינית, הינדי, סינהלית, תאית, רומנית, אוקראינית, אוזבקית). My reading; it is a row, easy to change.
- **Labels for the price fields are mine** (the list gives keys and units): מחיר החל מ, יחידת מחיר, מחיר ליום, מחיר
  לשבוע, מחיר לחודש, מחיר, דמי הובלה.
- **The card price.** Cards and search results read the listing's own `price` and `price_unit`. Where the category's
  answers include the price, that is what is written there (transport: "from" and its unit; equipment: the first of
  day, week, month; insurance: "הצעת מחיר" with no amount).
- **Regions.** A listing has `regions`, a list of region codes; "כל הארץ" is one of them. The provider form asks for
  regions instead of a city and one region, as the prompt says. City, capacity and "available from" are gone from the
  provider form.
- **A provider has no page to edit a listing.** The server accepts an edit of the answers; no screen sends one. It did
  not exist before either.

Screenshots: `P3_4c_form_{transport,insurance,equipment,scaffolding,courses}_390/1280` (ten),
`P3_4c_form_field-error_1280`, `P3_4c_detail-panel_transport_1280`.

**A bug found on the way and fixed (`0e7f306`).** A link to a listing followed inside the app, for example a provider
clicking its own listing on the dashboard, landed on the home page with the panel shut. Only a full page load opened
it. It predates this round.

### 3.4 · 5a · "מנוי ותשלום"

`/provider/billing`: per category the plan, its size, listings in use, the date, the price, the renewal switch,
upgrade, cancel, and "הוספת קטגוריה". The nav item R34 4a left out is in. No payment-method area, as the prompt says.

What the three actions do. These are my choices where the prompt gives a word and no rule:

| Action | What it does |
|---|---|
| Renewal on / off | Sets the flag on the plan. **Nothing reads the flag yet**: there is no renewal for these plans (Part 4) |
| Upgrade | Same plan row on a bigger tier of the same category. Free while the promo runs, as it would have been at registration. After the promo: 503, like a purchase. Bigger only |
| Cancel | The plan ends now. Its published listings are paused, not deleted, because a provider publishes only while it has a plan (R33 B). A plan that carries a payment reference is refused: what a paid plan is owed on cancellation is undecided |

**A hole closed with it.** Switching a listing between paused and active was a plain column write. Pause three
listings, publish three new ones in the freed places, switch the first three back on: six published on a three-ad plan.
A listing could also come back after its plan was gone. Turning a contractor's or a provider's listing back on now
takes a place on a running plan, through the same check creating a listing uses. Corporation listings are untouched.

**D1 and 5a pull in different directions on one line.** R34 5a asks for the renewal date and "the promo end date".
D1 says no date in "free" wording. I show the plan's own date in its row ("מועד חידוש" or "בתוקף עד") and the sentence
without a date: "הפרסום ללא עלות לתקופת ניסיון. לא נחייב אותך ללא הודעה מראש."

Dashboard: each listing card says its state in Hebrew (Part 5 item 4) and can pause or republish. A refused republish
shows the server's message and a link to the page that fixes it.

Screenshots: `P3_5a_plans_390/1280`, `P3_5a_cancel-dialog_1280`, `P3_5a_dashboard-listings_390`.

### Part 3 evidence

- Tests: user-org 255 (169 at the end of R33).
- Scratch MySQL built from staging's table definitions: plan management 37 checks, categories migration twice plus two
  edge cases, listing fields and region matching 22 checks.
- Staging, inside the user-org container, with temporary rows removed afterwards (0 left each time): 5a 18 of 18,
  4c 16 of 16. The 4c run includes a real search for "בצפון" returning the nationwide listing, the one with no region
  stated and the one serving centre and north.

Acceptance P4, line by line: forms for the five categories at both widths, yes. A provider with one plan sees only that
category, yes. `?category=housing` ignored, yes. A listing created in each category shows its answers, yes on staging
through the API and in the panel locally. An invalid attribute rejected by the server, yes, four kinds.

## Part 4 · Cardcom for provider plans

### 4.0 · The webhook route (done)

**Before**, on staging: `POST /api/webhooks/cardcom-recurring` answered `404 Cannot POST /webhooks/cardcom-recurring`,
an Express page. The path was public but had no rule of its own, fell under `/api/webhooks`, and reached the
notification service.

**After**: the path has its own rule, pointing at payment, listed before `/api/webhooks`. On staging it now answers
`401 {"error":{"code":"http_401","message":"unauthorized"}}`, the payment service's own envelope for a missing
signature. `/api/webhooks/vonage` still reaches notification.

Gateway test `test/webhook-routing.test.js`, 24 checks, pass: both destinations, the order, that a longer name is not
the Cardcom path, that `index.js` still mounts from the table.

Also found: `/api/webhooks/cardcom`, the webhook Cardcom calls after a card page, is not public and not routed to
payment (401 at the gateway). Nothing creates a card page today, so nothing calls it. I left it, and a test pins that
it has no rule yet.

### 4.1 · Where it stopped, and why

What the code actually has:

| The prompt says exists | What I found |
|---|---|
| LowProfile create | `create_low_profile()` is defined in `cardcom.py`. **Nothing calls it.** No route starts a card page |
| Token add and replace | No flow. A token row is written by the card-page webhook, which nothing triggers, or by `POST /payments/payment-methods`, which takes a raw token and the entity from the request body |
| The card block `/billing` uses | `/billing` has **no** card UI. `payments.ts` can list, delete and set a default; no page calls it |
| `RefundByTransactionId` | `refund_transaction()` is defined. **Nothing calls it** |
| Charging a stored token | Exists and is used: `charge_token()`, by subscription start, seat purchase and the renewal batch |
| Renewal job and failure rules | Exist, for contractors and corporations |

So 4.1.1 is not "extend the existing token flow to providers". It is "build card capture for the first time, for
anyone". That is a different size of work, and it is the kind of difference your guardrail says to stop on.

Two more reasons I did not push through:

- **I cannot do the acceptance.** Every line of it needs a card entered on Cardcom's page. I do not enter card numbers
  on a hosted page, test numbers included. You would have to do that step.
- **Staging is not set up the way the prompt assumes** (point 3 at the top).

**4.1.3 · done, because it needs no card.** After the promo, registration writes no plan. The provider is created,
the response says `plan_active: false`, and the site opens "מנוי ותשלום". This matches how a contractor registers:
account first, payment after. Until charging exists the purchase endpoint answers 503 after the promo, so a provider
who registers after 31.12.2026 cannot publish. That is the rule working. The welcome email states the plan, so it is
sent only when a plan was activated.

**4.1.4 · renewal, reported.** There is a job: the notification cron calls `/payments/subscriptions/internal/renewal-batch`.
Its failure rule: a failed charge sets `past_due` and retries every 3 days, 3 attempts, then `expired` and the
corporation's ads are paused. It serves the `subscriptions` table only. `marketplace_subscriptions` has none of the
columns it uses (`rebill_attempts`, `next_attempt_at`). I invented no schedule.

**4.1.7 · VAT, reported.** Contractor plans are charged with `vat_amount = 0` and `VATIncluded: true` on the invoice
head: the plan price is the price the customer pays, VAT inside it. I decided nothing for provider plans.

**What I need from you to finish Part 4:** your go-ahead knowing it starts from card capture; confirmation of the
staging terminal; and you at the keyboard for the card page when the acceptance runs.

## Part 5 · Small fixes

| # | Fix | Evidence |
|---|---|---|
| 1 | Provider rate limit 200 a minute (and 400 for telemetry), like a contractor | Test failed before (60 against 200), passes after |
| 2 | A listing filed as nationwide matches every regional search; so does one with several regions | Staging search, in 4c's run. Done in the 4c commit |
| 3 | "פורסם על ידי · ספק שירות" | Seen in the panel |
| 4 | Dashboard listing status in Hebrew: פעיל, מושהה, מושכר, נמכר | Done in the 5a commit |
| 5 | Business name once; one request for the profile | One call site in the source; heading is "לוח בקרה" |
| 6 | `admin_close` 404 for an unknown id | Staging: 404 `tender_not_found`; a non-admin 403 |
| 7 | A logged-in owner's own views are not counted | Staging: owner 204 and no row; another entity and an anonymous view recorded |
| 8 | Days in Israel time | Staging: a view at 00:30 local is counted for today; totals equal the series and a direct count |

Staging run for 7 and 8: 11 of 11, temporary rows removed.

Limits worth knowing: item 7 recognises an owner only when logged in, and cannot be applied to rows already written,
because listing events are stored with no actor. Item 2 changes one predicate in `routes/search.py`, the region filter;
ranking is untouched.

Left as is and only listed, as instructed: the OR-fallback demand flag, the 16 KiB body cap, the orphaned
`/admin/sponsor-stats` route.

## Part 6 · R35 · WhatsApp on Meta

Built as the prompt describes: a Meta sender in place of the Vonage one, the webhook (handshake, signature over the raw
body, 200 first and work after), unique message ids, and inbound message → search → one reply. SMS is untouched.

**Deviations, each one to accept or change:**

| # | What | Why |
|---|---|---|
| 1 | The per-number rate limit is counted in MySQL, on the stored inbound messages, not in Redis | The notification service has no Redis client and no dependency is added without asking |
| 2 | Over the limit, the message that crosses it gets "קיבלתי כמה הודעות, עונה על האחרונה" and the ones behind it get nothing | Every reply is billed; a flood should not be answered with a flood. Twelve in a row: 1 search, 2 notices, 9 silent |
| 3 | Housing lines are "city · N מיטות", with no "whole unit or beds" | The search response has no such field |
| 4 | `message_uuid` is widened from 64 to 128 characters | A Meta id runs to about 78 from an Android phone, and staging is in strict mode, where it would fail to insert |
| 5 | Near matches are not shown in the chat | The prompt does not mention them. With thin inventory the chat can say "לא מצאתי התאמות" while the linked page shows near matches. **Worth deciding before the acceptance run** |
| 6 | Reactions and system notices are ignored | Answering a thumbs-up would spend a billed message |
| 7 | The OTP has no default template name any more | A name Meta does not know cost a failed call on every login. Until `WHATSAPP_OTP_TEMPLATE_NAME` is set, every OTP goes by SMS |
| 8 | Default API version in code is `v26.0` | Taken from Meta's changelog by the subagent, not confirmed against your app. Set `WHATSAPP_API_VERSION` to what your dashboard shows |
| 9 | `052`'s header still says "Vonage" | An applied migration is hashed by the runner and would warn on every start. The correction is in `099`'s header |

Wording the subagent had to invent, since the prompt gives none: the title prefix "חיפשתם:", the line labels
"עובדים:", "דיור:", "שירות:", and "N מיטות", "עד N עובדים", "כמות N".

**Evidence.**
- 277 checks in five test files, run by me on Node 20 inside the service's container: all pass.
- Its SELECTs run read-only on staging: all parse and find their tables. Stored phones are all in `+972` form.
- Migration `099` on a scratch copy of staging's two tables: twice, with a 78-character id, and with duplicates
  present (it stops and deletes nothing). The duplicate check on staging returned no rows. Applied on staging.
- A signed and a forged webhook through the gateway to the router, with a local test secret: 200 and 401; the
  handshake 200 with the challenge and 403.
- Staging now: `GET /api/webhooks/whatsapp` → 403 and `POST` → 401, both from the notification service. That is the
  correct answer with no secrets set.

**Not verified, all of it waiting on your secrets:** Meta's handshake, a real signature, a real send, real status
callbacks, a real message from your phone, the 12-message run, and a real SMS OTP. I sent no SMS.

The verify token is in my closing message of this session, not in this file, so it is not in git.

---

## Findings

For a decision:

1. **`services` cannot be switched off yet.** Provider `f47f2a82…` holds a running plan there and has no listings, so
   "moves with its owner's listings" gives it nowhere to go. It is also one of the two providers D6 says to leave.
   Until it is settled, "שירותים" still shows in the registration picker with its ₪149 and ₪399 tiers.
2. **Equipment prices.** ₪149 and ₪399 on staging. No ₪200 tier was added.
3. **The scaffolding listing sits under `equipment`.** "פיגומים להשכרה" is a seed row; D7 covers only `services` and
   `other`. The `scaffolding` category has no listing.
4. **The staging frontend has no `NEXT_PUBLIC_FREE_LAUNCH_UNTIL`.** Its own `/api/config/promo` reports `null`. So the
   launch banner and the registration sentence do not show on staging at all, while the server does grant promo plans
   from `site_settings.launch_promo_end`. One promo, two switches, and they disagree.
5. **Plans do not end.** Nothing flips a plan's status at `expires_at` and its listings stay published. Every promo
   plan ends 31.12.2026.
6. **`POST /payments/payment-methods` trusts its body.** It stores a token for whatever entity the request names, with
   no check that the caller is that entity. Not reachable without a login, but any logged-in user qualifies.
7. **After a reveal, a provider's listing shows no business name.** The reveal returns the corporation's name only, so
   the line still reads "ספק שירות". I did not change what a reveal returns.
8. **The gateway's `/api/auth/` rate-limit exemption never matches.** It tests a path that is relative to the mount.
   Found by the subagent, confirmed by reading. Meta's webhooks will also count in the anonymous bucket.
9. **Two public lines still say corporations publish equipment and services:** `MarketplacePreview:91` and the
   marketplace page subtitle. Not in your table, so left.
10. **Seed listings use region `sharon`,** which is not a region code. They match no regional search. Not new.
11. **Three Vonage WhatsApp variables are still set on Railway** and are now dead. The old Vonage WhatsApp webhook
    routes are dead too and still in the code. `jsonwebtoken` in the notification service has no user left.

For information:

12. The legal documents are still drafts (`is_draft`).
13. A provider who registers after the promo gets no welcome email, since the only one written states a plan.
14. Local containers hold small temp folders I could not remove (a safety check blocked the removal):
    `/tmp/r37` and `/tmp/r35_run_a` in user-org, `/app/_r35check` in notification. They go when the containers are
    recreated. The local gateway and notification containers run this round's code by `docker cp`.
15. Two small files are left in the staging user-org container's `/tmp` (`ddl_support_messages.sql`,
    `ddl_whatsapp_message_log.sql`), from a read-only check. No data rows are left on staging from this round.

## `git diff -w --stat pre-r37..HEAD`

78 files changed, 6384 insertions(+), 631 deletions(-). By area:

| Area | Files |
|---|---|
| `db/migrations` | 098, 099, 100, 101, 102 |
| `services/user-org` | routes: marketplace, marketplace_subscriptions, providers, events, provider_stats, search; services: listing_attributes, provider_plans; five test files |
| `services/frontend` | provider billing, listing form, dashboard, shell, subscribe; CategoryFields; categoryStyle; listing card and panel; home page; copy files |
| `services/notification` | Meta sender, webhook, inbound handler, composer, dispatcher; five test files |
| `services/gateway` | serviceMap, index, rateLimit; two test files |
| `services/deal` | tenders, one test file |
| `docs`, `scripts`, `.env.example` | prompts, WhatsApp docs, seed script |

## Manual actions

1. Log in as admin, pick a corporation, open the admin tile, check `/admin/marketplace` and one import request. Still
   open from R33.
2. **Decide the `services` plan** of provider `f47f2a82…`: move it to a category, or cancel it. Either one lets
   `services` be switched off.
3. Review the tiers in `/admin/marketplace`: the four seeded at ₪200, and equipment's ₪149 and ₪399.
4. Check the transport and scaffolding fields with one real provider each. Also the language list and which fields, if
   any, should be required.
5. **Part 4:** say whether to build card capture from scratch. Confirm the staging terminal is a test terminal. When
   the acceptance runs, the card page is yours to fill.
6. Decide what a plan's end means before 31.12.2026 (finding 5). It can ride with Part 4.
7. Set `NEXT_PUBLIC_FREE_LAUNCH_UNTIL` on the staging frontend if the banner and the registration sentence should show
   there (finding 4).
8. **WhatsApp.** On Railway, staging, notification service: the six `WHATSAPP_*` variables, with the verify token from
   my closing message, then redeploy. In Meta: callback URL `https://staging.tagidai.com/api/webhooks/whatsapp`, the
   same verify token, subscribe to **messages**. Delete `VONAGE_APPLICATION_ID`, `VONAGE_PRIVATE_KEY`,
   `VONAGE_WHATSAPP_NUMBER`. Then tell me, and I run the acceptance. Decide deviation 5 (near matches) first.
9. Before production: the R33 backfill dry run, then `--apply`. Still open.
10. When Cardcom approves the main terminal: the production variables, as in the prompt.
11. In Cardcom, confirm the terminal and invoices are on אג'נטיק טכנולוגיות בע"מ. In Meta, rename the business
    portfolio if you want it to match.
