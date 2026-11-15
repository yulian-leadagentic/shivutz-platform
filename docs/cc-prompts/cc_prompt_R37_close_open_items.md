# CC prompt · R37 · Close everything still open after R33 and R34

**Date:** 15.11.2026 · **Owner:** Yulian · **Branch:** `pivot/v2`, deploy to staging as before
**Reads first:** `docs/cc-prompts/r33_report_1115.md`, `docs/cc-prompts/r34_report_1115.md`, `cc_prompt_R34_providers_and_copy.md`, `cc_prompt_R35_whatsapp_meta.md`, `cc_prompt_R36_operating_company.md`

This prompt is the run sheet for the remaining work. It answers the decisions both reports asked for, then sends you through the open parts in order. Where a part is already fully specified in an earlier prompt, this one points there and only adds what changed.

## STANDING RULE

- `git tag pre-r37` before the first change. One commit per item. Parts in order. After each part: a short status, evidence, screenshots at 390 and 1280, then the next part.
- **Never invent prices, plan sizes, legal claims or billing rules.** Where a value is Yulian's, leave it empty and list it under Manual actions.
- No em dashes (—) in any string you write or touch.
- Staging only. Do not touch production data or production env vars.
- Never store card data. Cards live in Cardcom; we keep only the token reference, as the existing `/billing` flow does.

---

## Decisions (Yulian, 15.11)

| # | Question from the reports | Decision |
|---|---|---|
| D1 | R34 manual 6 · the remaining "free" texts | **All of them become "לתקופת ניסיון".** No date and no day count in user-facing text. See Part 1 |
| D2 | R34 manual 7 · "קבלנים נבדקים מחדש כל שישה חודשים" | **Remove the revalidation promise entirely.** No sentence about periodic re-checks. The job itself stays as it is |
| D3 | R33 manual 4, R34 5b · provider payment after the promo | **Build Cardcom for `marketplace_subscriptions` now**, on the Cardcom test terminal on staging. See Part 4 |
| D4 | R34 Phase 3 · default price | ₪200 per provider category, 30 days, 5 ads, managed in `/admin/marketplace` (already in R34 Phase 3 item 2) |
| D5 | R33 finding 1 · seven checks left on the acting role | **Leave them.** An admin acting as a corporation sees what a corporation sees. No change |
| D6 | R34 manual 5 · two staging providers failing the ח.פ check | **Leave them.** No edit, no deactivation. The check runs at registration only |
| D7 | R34 manual 2 · where the `services` (7) and `other` (2) listings move | Move each listing by its content: transport → `transport`, insurance → `insurance`, courses → `courses`. The one active subscription on `services` moves with its owner's listings. All are seed rows. Report the mapping row by row before applying, then apply |
| D8 | R34 finding 1, R33 finding 8 · gateway rate limit for `service_provider` | Same ceiling as contractor and corporation (200 a minute) |

---

## Part 0 · Housekeeping

1. Add the prompt files that are still untracked to git in one commit: `cc_prompt_R32_accumulating.md`, `cc_prompt_R33_admin_role_and_category_billing.md`, this file, and any other `cc_prompt_R3*.md` not yet tracked. Leave `prod_env_hardening_0928.md` and `status_0927.md` untracked and list them.
2. Do not touch the deleted and untracked files under `docs/12_worker_images/`. They are Yulian's working files. List them in the report and leave them as they are.

---

## Part 1 · Copy (D1, D2, and the leftovers both reports found)

| Where | Change |
|---|---|
| `features/advertising/RevealModal.tsx:163, 172` | "הרשם כקבלן — 14 יום חינם" → "הרשמה כקבלן · חינם לתקופת ניסיון". Rewrite the line at 163 the same way if it promises a duration |
| `app/register/provider/page.tsx:590` | "הפרסום ללא עלות עד DD.MM.YYYY. לא נחייב אותך ללא הודעה מראש." → "הפרסום ללא עלות לתקופת ניסיון. לא נחייב אותך ללא הודעה מראש." |
| The confirm dialog on `/provider/marketplace/subscribe` (R33 B.3) | Same sentence as the row above |
| `FreeLaunchBanner` and any other component reading `NEXT_PUBLIC_FREE_LAUNCH_UNTIL` for display | Text only: "לתקופת ניסיון", no date. **The variable and `site_settings.launch_promo_end` stay** and keep driving when billing starts. Only what the user reads changes |
| Provider welcome email, `notification/src/consumers/handlers.js:270` | The promo block says "לתקופת ניסיון", no date |
| `app/how-it-works/page.tsx` (item 7 line) | Remove the sentence about re-checking contractors every six months. Keep the rest of the paragraph; fix the punctuation around the gap |
| Corporation listing form subtitle "פרסום ללא עלות למנויים" (R33 finding 9) | "פרסום דיור לעובדים במסגרת המנוי שלך" |
| Corporation listings page text "דיור, ציוד ושירותים" (R33 finding 9) | "דיור לעובדים" |
| `/admin/subscription-plans` pointer line with hard-coded "₪149 / ₪399" (R33 finding 7) | Read the prices from the plans table; no number in code |

Then `grep -rn "חינם\|ללא עלות\|בחינם" services/frontend/src services/notification/src services/user-org/app` and report every remaining hit with one line on why it stays or what you changed.

**Acceptance:** grep output; screenshots of the reveal modal, provider registration, the subscribe dialog, how-it-works, the corporation listing form.

---

## Part 2 · R36 · Operating company

Run `cc_prompt_R36_operating_company.md` as written. Small and independent.

---

## Part 3 · R34 remainder · categories, form, plan management

Everything R33 gated is now unblocked. Run from `cc_prompt_R34_providers_and_copy.md`:

1. **Phase 3**, with D4 and D7. Item 2 (₪200 seeded tiers) is in the current version of the file; if your copy says "leave prices empty", re-read it from disk. Equipment's existing ₪199 / ₪499 tiers stay; report them.
2. **4b** · category choice limited to categories with an active plan.
3. **4c** · `field_schema` and `attributes`, the five provider schemas.
4. **5a** · "מנוי ותשלום" for a provider. Add it to the provider shell nav now that the page exists (R34 4a left it out on purpose). The payment-method area on this page is built in Part 4; until then it shows nothing rather than a dead link.

Acceptance as in R34 for each phase.

---

## Part 4 · Cardcom for service-provider plans (D3, replaces R34 5b)

### What exists (from the reports)
- The payment service already runs Cardcom for the contractor and corporation `subscriptions` table: LowProfile (`LowProfile/Create`, `GetLpResult`), token add and replace, J5, invoices, `RefundByTransactionId`, `payment_methods.py`, `/billing`.
- `POST /marketplace/subscriptions` answers 503 `cardcom_not_configured` outside fake mode and after the promo.
- After the promo, provider registration activates a full-price plan without charging (R33 finding 2). This part closes that.

### 4.0 · Check the webhook route first
The gateway maps `/api/webhooks` to the **notification** service (`gateway/src/index.js:174`), while `/api/webhooks/cardcom-recurring` is in the public list and its handler lives in the **payment** service (`payment/app/routes/webhooks.py:32`). Find out where a request to that path actually lands today, on staging, and report it before changing anything. If it reaches notification, route that exact path to payment with a more specific rule, keep `/api/webhooks/vonage` where it is, and add a gateway test that pins both.

### 4.1 · Build
1. **Payment method for a provider.** Extend the existing token flow to `entity_type = service_provider`: add card and replace card through LowProfile, token reference stored the same way as for contractors. The provider's "מנוי ותשלום" page (Part 3.4) gets the same card block `/billing` uses. Reuse, do not fork.
2. **Charge on purchase.** After the promo, buying a category plan charges the plan's price from the tier row against the provider's token, issues the invoice through the same Cardcom document flow `/billing` uses, and only then activates the `marketplace_subscriptions` row. A failed charge activates nothing and shows the Cardcom error in Hebrew.
3. **Registration after the promo.** No plan activates without a successful charge. Registration either collects a card through LowProfile or creates the provider with no active plan and sends them to "מנוי ותשלום". Pick the one that matches how contractor registration already handles payment and say which you picked.
4. **Renewal.** Auto-renew plans renew through the same mechanism and the same failure rules the contractor `subscriptions` table uses. **If there is no renewal job or no failure rule there, stop and report.** Do not invent a retry schedule or a grace period.
5. **Refund.** An admin action on a provider subscription that refunds through `RefundByTransactionId`. The terminal now has the "זיכוי כרטיס או אסימון" permission. Confirm dialog, audit row, admin only.
6. **Do not trust a webhook body.** On any Cardcom callback, confirm the deal server to server (`GetLpResult` or the transaction lookup) before activating anything. Idempotent: a repeated callback changes nothing.
7. **VAT and invoice lines.** Treat the tier price exactly as the contractor plans treat theirs (VAT included or added). Report which one it is. Do not decide it yourself.

### 4.2 · Environment
- Staging stays on the **Cardcom test terminal**. Do not ask for, read, print or log the real API name or password, and do not set production variables. The real terminal goes live as a manual step after Cardcom approves it.
- `PAYMENT_FAKE_MODE` stays off on staging; test against the Cardcom test terminal with its published test cards.

### Acceptance (staging, test terminal)
- [ ] 4.0: where the cardcom path landed before, where it lands after, gateway test output
- [ ] A provider adds a card, the token row exists, no card data in our DB (show the row)
- [ ] With `launch_promo_end` set to yesterday on staging only: a purchase charges ₪200, an invoice is issued, the plan activates. Restore the date afterwards
- [ ] A declined test card: nothing activates, Hebrew error shown
- [ ] A repeated webhook call changes nothing
- [ ] An admin refund on a test charge succeeds and is recorded
- [ ] A second provider cannot see or use the first provider's card or invoices (403/404)

---

## Part 5 · Small fixes from the reports' findings

| # | Fix | Source |
|---|---|---|
| 1 | Gateway rate limit: `service_provider` gets the contractor and corporation ceiling (D8) | R34 f1, R33 f8 |
| 2 | A listing with `region='national'` matches every regional search (`routes/search.py:365`) | R34 f3 |
| 3 | Detail panel label for a provider's listing: "פורסם על ידי · ספק שירות", not "תאגיד" | R34 f4 |
| 4 | Provider dashboard listing status in Hebrew (`paused` → "מושהה", and the other statuses) | R34 f9 |
| 5 | Business name shown once on the provider dashboard; `/organizations/providers/me` fetched once | R34 f8 |
| 6 | `admin_close` answers 404 for a request id that does not exist | R33 f6 |
| 7 | A logged-in owner's own impressions and opens are not counted, where the gateway identity makes the owner known | R34 f5 |
| 8 | Dashboard day boundary in Israel time (Asia/Jerusalem), totals and series still consistent | R34 f6 |

Leave as is and only list: the OR-fallback demand flag (R34 f7), the 16 KiB body cap (R34 f2, it belongs to a gateway round), the orphaned `/admin/sponsor-stats` route (R33 f5).

---

## Part 6 · R35 · WhatsApp on Meta

Run `cc_prompt_R35_whatsapp_meta.md` as written. Do not switch off Vonage SMS. Do not change WhatsApp billing; Yulian moves it from Vonage to the company card by hand after this part is live.

---

## Guardrails

- Do not touch: reveal billing for workers, `contact_reveals`, the search ranking, corporation housing publishing.
- No new npm or pip dependency without asking.
- If anything in this prompt contradicts what you find in the code, stop at that item, report, and carry on with the next independent item.

## Report

One file, `docs/cc-prompts/r37_report_1115.md`, in the shape of the R33 and R34 reports: a status table per part, commits, evidence, what you did not verify, findings, `git diff -w --stat pre-r37..HEAD`, and Manual actions.

## Manual actions (expected, for Yulian)

1. Log in as admin, pick a corporation, open the admin tile, check `/admin/marketplace` and one import request (R33 manual 1, still open).
2. Review the seeded ₪200 tiers in `/admin/marketplace`.
3. Check the transport and scaffolding fields with one real provider each.
4. When Cardcom approves the main terminal: generate a new API password, put the real terminal number, API name and password into Railway for the production payment service, redeploy.
5. Before production: the R33 backfill dry run, then `--apply`.
6. After Part 6: the Meta webhook URL and verify token, the `WHATSAPP_*` variables in Railway, then WhatsApp billing from Vonage to the company card.
