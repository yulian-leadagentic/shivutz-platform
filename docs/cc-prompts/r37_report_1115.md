# R37 report · 15.11.2026

Branch `pivot/v2`, deployed to staging. `git rev-list --left-right --count origin/staging...origin/pivot/v2` = `0	0`.
Tag `pre-r37` is at `1de4bc3`, the last R33 commit. 35 commits since, this update included, 103 files.
Tag `pre-r37-p4` is at `c73feca`, the first version of this report, before Part 4.1 was built.

**Updated 15.11.2026, evening:** Part 4.1 is built and live on staging. The sections that said it had stopped are
rewritten: "What to know first", the status table, Part 4, findings 5 and 6, and Manual actions 5, 6, 12 to 15.

## What to know first

1. **Every part is now done and live on staging**, Part 4 included. You said to build card capture from scratch; it is
   built, with the charge on purchase, renewal, the admin refund and the webhook.
2. **None of Part 4 has met Cardcom.** Staging's payment service runs with `PAYMENT_FAKE_MODE` on, and I do not type a
   card into Cardcom's page, test cards included. So the whole flow is verified in fake mode: on staging (40 checks),
   against MySQL built from staging's own table definitions (91 checks), and in unit tests (126 in payment). What that
   cannot show is what Cardcom itself answers. The first real run on the test terminal is yours (Manual action 12),
   and it may turn up a field that is not where Cardcom's API description says it is.
3. **The four Cardcom calls in the code were all in the wrong shape.** Checked against Cardcom's published v11 API
   description, none matched: the card page would have charged instead of saving a card, and a token charge sent no
   expiry and no invoice block. None had ever run for real. I rewrote the four from the description. This also changes
   what the three contractor charges send, since it is one function.
4. **Two facts about staging's payment service, unchanged:** `PAYMENT_FAKE_MODE` is **on** there, and the Cardcom
   terminal number is set to something that is **not** the public test terminal. I did not read the value and I did not
   switch fake mode off. Please confirm it is a test terminal before you do.
5. **Renewal and refund needed choices the prompt does not make.** I took the closest reading of the contractor rules
   and listed each choice under Part 4 ("Choices for you to confirm"). The two that matter most: a paid plan with no
   card on file is not renewed for free (a contractor subscription is), and a refund does not change the plan.
6. **`/api/webhooks/cardcom` is now public at the gateway.** It has to be, Cardcom carries no user token. What guards
   it is in the handler and is described under 4.1.6.
7. **One of your decisions could not be applied as written.** D7 says the one plan on `services` "moves with its
   owner's listings". Its owner has no listings. I left that plan and the `services` category alone. One answer from you
   closes it (Manual action 2).
8. **A promo plan still just ends.** Every promo plan ends on 31.12.2026. Renewal now exists, for plans a charge paid
   for. A promo plan is never charged by it, and nothing happens when it ends: its status is not changed and its
   listings stay published. That decision is still open (Manual action 6).

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
| 4.1.1 | Card for a provider | Done, live. Verified in fake mode only |
| 4.1.2 | Charge on purchase | Done, live. Verified in fake mode only |
| 4.1.3 | Registration after the promo | Done, live |
| 4.1.4 | Renewal | Done, live, on the contractor job and its failure rule. Four choices to confirm |
| 4.1.5 | Refund | Done, live. Verified in fake mode only |
| 4.1.6 | Webhook verification | Done, live |
| 4.1.7 | VAT | Reported and applied: the tier price is charged as it stands, VAT inside it |
| 5 | Eight small fixes | Done, live |
| 6 | R35 WhatsApp on Meta | Code done, live. Nothing has met Meta yet; needs your secrets |

Order: 4b and 5a were in progress when R37 arrived, so they were finished first and Parts 0 to 2 followed. Part 6 was
written by a subagent in parallel with Parts 2 to 5; I reviewed it, ran its tests and its SQL, and committed it last.

## Commits

```
78bae9a R37 4.1 · two things the browser showed on the plans page
920484a R37 4.1.5 · an admin returns a plan charge to the card, once, on record
3959bff R37 4.1.4 · a paid plan renews in the subscriptions' batch, by its failure rule
e7cf552 R37 4.1.2 · after the promo a provider's plan is charged for, then activated
47bb9db R37 4.1.6 · Cardcom's card-page webhook: reachable, and believed for nothing
2283a06 R37 4.1.1 · a provider adds or replaces its card on Cardcom's page
820f9e2 R37 4.1 · the Cardcom calls in the shape Cardcom's API has
c73feca R37 report · what shipped, where Part 4 stopped, and what needs a decision
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
company, `101` categories, `102` listing fields, `103` card setups, `104` plan charges, `105` the plan's renewal
columns and the `past_due` status.

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

Also found then: `/api/webhooks/cardcom`, the webhook Cardcom calls after a card page, was not public and not routed
to payment. That is fixed in 4.1.6 below; the test now has 29 checks.

### 4.1 · Built

The first pass stopped here: the prompt builds on a card flow that did not exist (my R34 report had said it did). You
answered "go ahead, building Cardcom card capture from scratch". This is what was built.

#### The Cardcom calls (`820f9e2`)

Checked field by field against Cardcom's published v11 API description. All four were wrong, and none had ever run
against Cardcom: nothing called two of them, and staging charges in fake mode.

| Call | What the code sent | Now |
|---|---|---|
| Card page (`LowProfile/Create`) | No `Operation`, so the page would have **charged** the amount. An API password the request does not take. Old names for the failure address and the coin | `Operation: CreateTokenOnly` with a J2 check: the card is validated, a token comes back, no money moves |
| Page result (`GetLpResult`) | Read the last digits, brand and expiry from fields the answer does not have | Reads `TokenInfo`, `TranzactionInfo`, `UIValues`. A page the holder has not finished is "pending", not a failure |
| Token charge (`Transactions/Transaction`) | No card expiry. The invoice as `InvoiceHead` and `InvoiceLines`, which v11 does not read, so **no document would have been issued** | Token, expiry, our own id against a double charge, and a `Document` block |
| Refund (`RefundByTransactionId`) | Named the transaction by a field the request does not have | `TransactionId`, with the API password this call does take |

Also here: what is kept of a Cardcom answer in `payment_events.raw` is now a list of what may stay. The answers carry
the token, the first digits of the card and the holder's id number and phone, and nothing filtered them.

The three contractor charges (start, extra seats, renewal) go through the same function, so they now send the card's
expiry and the `Document` block too. Their flow is otherwise untouched.

#### 4.1.1 · A provider adds or replaces a card (`2283a06`)

- `POST /payments/payment-methods/setup`, for the logged-in entity. Writes a pending row in a new table,
  `payment_card_setups` (migration 103), that says whose setup this is, and answers the address of Cardcom's page.
- The card is typed on Cardcom's page. Cardcom sends the browser back to "מנוי ותשלום" with `?card_setup=<id>`.
- `POST /payments/payment-methods/setup/{id}/confirm`: the page asks whether the card was saved. Only for the caller's
  own setup; anyone else's reads as 404. The answer comes from asking Cardcom.
- A card is stored in one place, after Cardcom confirmed the page, for the entity on **our** row.
- A new card replaces the old one.

**What is stored.** The token, encrypted as before, and what a person needs to recognise the card: last four digits,
brand, expiry, holder name. The same columns `payment_methods` always had. No card number, no CVV. The row from
staging (fake mode, so an obviously fake card):

```
entity_type: service_provider   provider: cardcom   provider_token: <96 chars, encrypted>
last_4_digits: 0000   card_brand: fake   card_holder_name: None   expiry: 12/2099   is_default: 1   status: active
```

**Removed:** `POST /payments/payment-methods`, the route that stored a token taken from the request body for an entity
named in the body (finding 6). Nothing called it. On staging it now answers 405.

**The page.** "מנוי ותשלום" has an "אמצעי תשלום" block: the card on file, "הוספת כרטיס" or "החלפת כרטיס", and the result
when the browser comes back (saved, not confirmed yet with a "בדיקה שוב" button, not saved with Cardcom's reason). The
block is a shared component, written to sit on any billing page.

**"The same card block `/billing` uses":** `/billing` has none, so there was nothing to reuse. The server flow serves
contractors and corporations as well, the entity types `payment_methods` already held, but only the provider page got
the block. Putting it on `/billing` is one line and a decision (Choices, 9).

**Real mode needs two settings on the payment service:** `FRONTEND_URL` and `PUBLIC_API_URL`. Staging had neither;
both were set on 16.11.2026 at your word (see the note under Manual action 12). Without them, and with fake mode off,
adding a card answers 503 and opens no page. In fake mode there is no Cardcom
page: the browser comes straight back and a card marked "כרטיס בדיקה" is saved.

#### 4.1.6 · The card-page webhook (`47bb9db`)

`/api/webhooks/cardcom` is routed to payment and public. Nothing in the call is believed:

- one value is read from it, the id of the page, and only to find our own pending row for that page;
- whose card it is comes from that row, never from the body;
- whether a card was saved comes from asking Cardcom (`GetLpResult`), and the result must name our row;
- a page id we never issued does nothing;
- a repeated call finds the row finished and changes nothing;
- the answer is the same `200 {"received": true}` whatever happened.

The return page and the webhook finish a setup through the same code; whichever arrives first does the work, and a row
lock makes the two arriving together store one card.

Charges have no callback to distrust: a token charge is one server to server call, answered in the same call.

#### 4.1.2 · Charge on purchase (`e7cf552`)

After the promo, a provider buying a plan is charged the tier row's price, and the plan is activated only if Cardcom
confirms.

- **user-org** still decides whether the purchase may happen. When it may, it writes the purchase down in a new table,
  `payment_db.marketplace_charges` (migration 104), with the tier's price, size and length, and asks payment to
  charge. It writes no plan row.
- **payment** charges the card for the amount **on that row**. The route takes no amount, tier or entity from the
  request. After Cardcom confirms, it writes the plan row and marks the charge as charged in one transaction.
- Declined card: 402, in Hebrew, with Cardcom's own text when it gave one. No card on file: 402, with the page that
  adds one. Cardcom unreachable: 502. None leaves a plan.
- Against a double charge: one purchase at a time per provider and category; a charge row is taken for charging once;
  its id goes to Cardcom as the transaction's own id.
- The invoice comes from the `Document` block of the charge. It is made out to the provider's name and email; the
  business number goes on it only when it has nine digits.

The page: the purchase dialog now says what will be charged and that the plan renews, and its button reads "אישור
וחיוב". Without a card the dialog does not open; the page points at "מנוי ותשלום". "מנוי ותשלום" lists the provider's
charges with their invoice links.

Contractors and corporations buying a marketplace plan are where they were: 503.

#### 4.1.3 · Registration after the promo (done in the first pass, `66a0888`)

No plan at registration once the promo is over. The provider is created and sent to "מנוי ותשלום". This matches how a
contractor registers: account first, payment after. With 4.1.2 the path now continues: add a card there, then
"הוספת מסלול", then the charge.

#### 4.1.4 · Renewal (`3959bff`)

There is a renewal job and a failure rule, so they are used, not rebuilt. The notification cron calls
`/payments/subscriptions/internal/renewal-batch` every day; that batch now also renews paid plans in the same pass,
and is handed its own numbers (3 days, 3 attempts), not a copy of them.

| | |
|---|---|
| Charged | Another period from now |
| Declined | `past_due`, another attempt in 3 days |
| 3 failed attempts | The plan ends (`expired`) |
| Cardcom unreachable | Nothing changes; the next pass tries again |
| Attempted within the hour | Left alone |

Which plans: only a plan a charge paid for, with renewal on. **A promo plan is never charged here**, with or without a
card on file. Migration 105 gives the plan row what the chain needs.

The page shows a plan whose renewal failed, with the date of the next attempt. A paid plan with renewal on says that
the card will be charged at the renewal date and that turning renewal off prevents it.

#### 4.1.5 · Refund (`920484a`)

An admin section on `/admin/marketplace`, "חיובי מסלולים": every plan charge with the provider's name, the invoice
link and its state, and "זיכוי" on a charge that was taken.

- Admin only. A provider is refused, its own charge included.
- Confirm dialog, which says how much goes back, to whom, that the plan is not changed and that it cannot be undone.
- Through `RefundByTransactionId`, for the whole amount.
- On record every time: a `payment_events` row of kind `marketplace_refund` with the outcome, the charge, the plan, the
  transaction refunded and the admin. On success the charge row also keeps when, by whom, and Cardcom's refund id.
- Once: a refunded charge is refused, and two clicks make one refund.

#### 4.1.7 · VAT

Contractor plans are charged with `vat_amount = 0`: the plan price is what the customer pays, VAT inside it. Provider
plans are charged the same way, the tier price as it stands. The one line of the document carries the whole amount.
I decided nothing beyond following the contractor plans.

#### Evidence

**Staging, inside the payment container, 40 checks, all pass** (`stg_p41.py`). Fake mode. Temporary providers named
"QA R37 P41", removed at the end: 0 rows left in six tables. `launch_promo_end` was set to yesterday for the purchase
checks and put back in a `finally`: it read `2026-12-31` before and after.

| Acceptance line | Result on staging |
|---|---|
| 4.0 before and after, gateway test | Done in the first pass. Test now 29 checks |
| A provider adds a card, the token row exists, no card data | **Pass, fake mode.** Row shown above |
| Promo yesterday: a purchase charges ₪200, an invoice is issued, the plan activates; date restored | Charge of ₪200 and activation: **pass, fake mode.** Date restored. **No invoice**: fake mode issues no document |
| A declined test card: nothing activates, Hebrew error | **Pass with the fake-mode decline switch**, not with a Cardcom test card. Message: "החיוב לא אושר על ידי חברת האשראי. המסלול לא הופעל." |
| A repeated webhook call changes nothing | **Pass.** A finished page twice; a pending page twice and then the return page: one card |
| An admin refund on a test charge succeeds and is recorded | **Pass, fake mode.** Charge row and audit row checked |
| A second provider cannot see or use the first one's card or invoices | **Pass.** Card by id 403, its setup 404, its charge 404, lists empty |

Also on staging: a lapsed paid plan was renewed (charged, 30 more days, a renewal charge row); a declined renewal went
to `past_due` with the next attempt in 72 hours; the pass touched no other plan.

**From outside, through the gateway:** `POST /api/webhooks/cardcom` answers `200 {"received":true}`;
`/api/payments/payment-methods/setup`, `/api/payments/marketplace/charges`, `.../pay` and `.../refund` answer 401
without a login.

**MySQL built from staging's table definitions plus migrations 103 to 105:** 78 checks in the payment code (card 24,
purchase 18, renewal 24, refund 12) and 13 in user-org's purchase route, all pass. The renewal run walks the whole
chain: three declines, the plan ends, its listings are paused; a card replaced mid-chain is charged at the next
attempt; a promo plan with a card on file is not charged.

**Unit tests:** payment 126 pass (6 before this round). user-org's two plan files 68 pass (13 new). Gateway webhook
routing 29 checks.

**Browser**, locally, with the API stubbed, at 390 and 1280. Screenshots in the scratchpad, `r37-screenshots/P41_*`
(13 files): the plans page with no card, with a card saved, with a card not saved, with a failed renewal and a paid
plan; the purchase dialog, a charged purchase, a purchase with no card, a declined purchase; the admin list, the
refund dialog, a refunded row. The deployed staging bundle contains the new screens' strings.

#### Not verified

- **Anything Cardcom answers.** Whether the page opens, where the last digits and the expiry sit in the result of a
  card saved without a charge, whether the charge is accepted with the expiry as sent, whether the document is issued,
  whether the refund is accepted, and what the webhook body looks like. The handler reads the page id from the query
  string, a JSON body or a form body, whichever Cardcom sends.
- **The card page round trip in a browser.**
- **The contractor charges in their new shape.** Same function, same reason.
- **The cron's own call on staging.** I ran the plan pass in the payment process, so that no contractor or corporation
  subscription was touched outside its schedule. A unit test pins that the batch calls the pass with its own numbers.
- **The new screens on staging with a login.** Verified locally with a stubbed API.

#### Choices for you to confirm

Each is where the prompt or the contractor rules did not decide, and what I did.

1. **Renewal price.** The tier row's price and length on the day of renewal, as a contractor subscription renews at
   its plan's current price. A price you change reaches every renewing plan with no notice to the provider.
2. **No card on a paid plan.** A contractor subscription with no card is moved forward a period for free (R9). A paid
   plan is not: the renewal counts as failed and the plan goes down the 3 days, 3 attempts chain. Otherwise removing
   the card would mean publishing for free.
3. **The end of the chain.** The plan's published listings are paused, not deleted, as cancelling a plan does. The
   contractor rule pauses a corporation's ads at the same point.
4. **During `past_due`.** The plan's listings stay published; new ones cannot be published under it. A contractor in
   `past_due` keeps full access.
5. **A refund does not change the plan.** It moves money and nothing else. A refunded plan stays active and still
   renews. If a refund should end the plan, say so.
6. **A paid plan cannot be upgraded or cancelled at once.** Both are refused by the server (what each costs or returns
   is not decided), so the page does not offer them on a paid plan. Its owner can turn renewal off.
7. **Renewal is on by default at purchase,** as it was before. The dialog now says so. Please read its wording.
8. **The invoice line** reads "מסלול פרסום בשירותים נלווים · <category> · <tier> · 30 ימים". Yours to word.
9. **Contractors and corporations.** They can save a card through the API but have no card block on `/billing`, and
   their marketplace purchase still answers 503. Say if either should change.
10. **`FREE_LAUNCH_UNTIL` on the payment service.** While it is set, a charge answers "charged" with nothing charged.
    A plan purchase or renewal is refused in that state (503), not waved through.
11. **A charge Cardcom did not answer** is recorded as `error`, with no plan. Whether money moved is not known; the
    admin list shows such rows so they can be looked up at Cardcom.
12. **One card per entity.** A new card removes the old one.

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
5. **Promo plans do not end.** Nothing flips a promo plan's status at `expires_at` and its listings stay published.
   Every promo plan ends 31.12.2026. A paid plan now does end, when its renewal chain runs out (4.1.4). The same goes
   for a paid plan whose owner turned renewal off: nothing touches it at its end.
6. **Fixed in 4.1.1.** `POST /payments/payment-methods` stored a token for whatever entity the request named. The
   route is removed.
7. **After a reveal, a provider's listing shows no business name.** The reveal returns the corporation's name only, so
   the line still reads "ספק שירות". I did not change what a reveal returns.
8. **The gateway's `/api/auth/` rate-limit exemption never matches.** It tests a path that is relative to the mount.
   Found by the subagent, confirmed by reading. Meta's webhooks will also count in the anonymous bucket.
9. **Two public lines still say corporations publish equipment and services:** `MarketplacePreview:91` and the
   marketplace page subtitle. Not in your table, so left.
10. **Seed listings use region `sharon`,** which is not a region code. They match no regional search. Not new.
11. **Three Vonage WhatsApp variables are still set on Railway** and are now dead. The old Vonage WhatsApp webhook
    routes are dead too and still in the code. `jsonwebtoken` in the notification service has no user left.

16. **`docs/RAILWAY_SECRETS_CHECKLIST.md` says staging runs fake mode "while testing" and terminal `1000`.** The
    prompt says fake mode stays off on staging. Staging has fake mode on and a terminal that is not `1000`. Three
    statements, none matching another.
17. **Three more Cardcom functions are in the old request shape** and have no caller: the J5 hold, its capture and its
    release (`authorize_low_profile`, `capture_transaction`, `void_transaction`). Left as they are.

For information:

12. The legal documents are still drafts (`is_draft`).
13. A provider who registers after the promo gets no welcome email, since the only one written states a plan.
14. Local containers hold small temp folders I could not remove (a safety check blocked the removal):
    `/tmp/r37` and `/tmp/r35_run_a` in user-org, `/app/_r35check` in notification. They go when the containers are
    recreated. The local gateway and notification containers run this round's code by `docker cp`.
15. Two small files are left in the staging user-org container's `/tmp` (`ddl_support_messages.sql`,
    `ddl_whatsapp_message_log.sql`), from a read-only check. No data rows are left on staging from this round.
18. From Part 4.1, locally: temp folders `/tmp/r37p41_a` to `_g` in the payment container and `/tmp/r37p41_u1` in
    user-org (same safety check, they go when the containers are recreated). The four scratch databases in the local
    MySQL were dropped. Nothing is left on staging: the run printed 0 rows in each table it used.

## `git diff -w --stat pre-r37..HEAD`

103 files changed, 11161 insertions(+), 871 deletions(-). Part 4.1 alone (`pre-r37-p4..HEAD`): 36 files, 4300
insertions, 268 deletions. By area:

| Area | Files |
|---|---|
| `db/migrations` | 098, 099, 100, 101, 102, 103, 104, 105 |
| `services/user-org` | routes: marketplace, marketplace_subscriptions, providers, events, provider_stats, search; services: listing_attributes, provider_plans; five test files |
| `services/payment` | services: cardcom, card_setup, marketplace_charges, marketplace_renewal, marketplace_refunds; routes: payment_methods, webhooks, marketplace_charges, subscriptions; main; seven test files |
| `services/frontend` | provider billing, listing form, dashboard, shell, subscribe; PaymentCardBlock, MarketplaceCharges, MarketplaceChargesAdmin; CategoryFields; categoryStyle; listing card and panel; home page; admin marketplace; copy files |
| `services/notification` | Meta sender, webhook, inbound handler, composer, dispatcher; five test files |
| `services/gateway` | serviceMap, index, rateLimit; two test files |
| `services/deal` | tenders, one test file |
| `docs`, `scripts`, `.env.example` | prompts, WhatsApp docs, seed script, the two new payment settings |

## Manual actions

1. Log in as admin, pick a corporation, open the admin tile, check `/admin/marketplace` and one import request. Still
   open from R33.
2. **Decide the `services` plan** of provider `f47f2a82…`: move it to a category, or cancel it. Either one lets
   `services` be switched off.
3. Review the tiers in `/admin/marketplace`: the four seeded at ₪200, and equipment's ₪149 and ₪399.
4. Check the transport and scaffolding fields with one real provider each. Also the language list and which fields, if
   any, should be required.
5. **Part 4:** built. What is left is the run against Cardcom, action 12.
6. Decide what a promo plan's end means before 31.12.2026 (finding 5). Part 4 did not decide it: a promo plan is
   never charged and nothing happens to it at its end.
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
12. **The real run on the Cardcom test terminal, staging, payment service.** In this order:
    1. Confirm in Cardcom that the terminal number set on staging is a test terminal.
    2. Check the terminal may create a token without a charge and may refund ("זיכוי כרטיס או אסימון").
    3. ~~Set `FRONTEND_URL` and `PUBLIC_API_URL`.~~ **Done 16.11.2026**, on staging's payment service only:
       `FRONTEND_URL=https://staging.tagidai.com` (the value notification, user-org and admin already use) and
       `PUBLIC_API_URL=https://staging.tagidai.com/api`. The service restarted with both. Fake mode is still on.
       In real mode Cardcom would be given `https://staging.tagidai.com/provider/billing?card_setup=<id>` to return
       to and `https://staging.tagidai.com/api/webhooks/cardcom` to call; that address answers
       `200 {"received":true}` from outside. Adding a card in fake mode still works. Production was not touched.
    4. Make sure `FREE_LAUNCH_UNTIL` is not set there.
    5. Set `PAYMENT_FAKE_MODE=0` and redeploy.
    6. As a provider on staging: "מנוי ותשלום", "הוספת כרטיס", a Cardcom test card. The card should appear in the block.
    7. Tell me, and I set `launch_promo_end` to yesterday, you buy a plan, I read the rows and the invoice with you,
       you try a card Cardcom declines, you refund from `/admin/marketplace`, and I put the date back.
    If step 6 fails, send me the time and I read the payment log: the likeliest cause is a field Cardcom names
    differently from its description.
13. **Read the Hebrew I wrote for money.** The purchase dialog (the charge sentence and the renewal sentence), the note
    under the card ("מספר הכרטיס המלא אינו נשמר במערכת"), the failed-renewal notice, the refund dialog, and the
    invoice line.
14. **Decide the twelve choices** under Part 4, "Choices for you to confirm". 2 and 5 first.
15. Bring `docs/RAILWAY_SECRETS_CHECKLIST.md` in line with what you decide for staging (finding 16).
