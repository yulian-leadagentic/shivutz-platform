# CC prompt · R34 · Service providers end to end, and copy fixes

**Date:** 15.11.2026 · **Owner:** Yulian · **Branch:** the deploy branch confirmed in R32
**Depends on R33.** Start R34 only after R33 is merged and deployed (admin permission fix A1, paid categories B, copy fix C). Where an item below builds on R33, it says so.

Source list: `claude/open_items_15_11.md` (items 1–17). Items 1–3 are R33. This prompt covers 4–17.

## STANDING RULE

`git tag pre-r34` before the first change. One commit per item. Phases in order; at the end of each phase post a short status and screenshots at 390 and 1280 before starting the next. **Never invent prices, plan sizes or legal claims.** Where a value is Yulian's to set, leave it empty and list it under Manual actions.

---

# Phase 1 · Copy (items 4–9, 11, 15)

No em dashes (—) in any string you touch; use a comma, colon or full stop. Number ranges with an en dash are fine.

### `app/how-it-works/page.tsx`
| # | Where | Now | New |
|---|---|---|---|
| 4 | `:163` button | הרשמה כקבלן — חינם | הרשמה כקבלן · חינם לתקופת ניסיון |
| 5 | `:254` | ספק שירותים? הרשמה חופשית ופרסום ללא עלות עד סוף 2026. | ספק שירותים? הרשמה ופרסום ללא עלות לתקופת ניסיון. |
| 7 | `:301` contractors | …וקבלני tier_2 נבדקים מחדש כל שישה חודשים. | …בעת ההרשמה. קבלנים נבדקים מחדש כל שישה חודשים. |
| 8 | `:307` corporations | נבדקים מול רשם החברות (data.gov.il) וברשימת … המיובאת מדי שנה מ-PDF רשמי. תאגיד שאינו ברשימה — אינו יכול לפרסם. | נבדקים מול רשם החברות וברשימת תאגידי כוח אדם המורשים של רשות האוכלוסין וההגירה, המתעדכנת מדי שנה ממקור רשמי. תאגיד שאינו ברשימה אינו יכול לפרסם. |
| 9 | providers block | (current text) | נבדק עוסק מורשה או ח.פ. **Ship this line only together with Phase 2**, since Phase 2 is what makes it true. |
| 11 | `:318–336` | the "הצטרף עכשיו" CTA section (`aria-label="הרשמה"`) and the line under it | **remove the section and its comment block.** Registration stays reachable from the item-4 button and the nav "הצטרף עכשיו" |

### Same "free until end of 2026" wording elsewhere (item 6)
- `app/provider/dashboard/page.tsx:130` "…חינם עד סוף 2026." → "…חינם לתקופת ניסיון."
- `components/landing/RegistrationCTASection.tsx:95` "ללא דמי מנוי — חינם עד סוף 2026" → "ללא דמי מנוי לתקופת ניסיון"
- `features/advertising/RoleRegisterPicker.tsx:31` "…חינם עד סוף 2026." → "…חינם לתקופת ניסיון."
- `RegistrationCTASection.tsx:50,70,90` "הצטרף עכשיו כקבלן / כתאגיד / כספק — בחינם" → "הצטרף עכשיו כקבלן · חינם לתקופת ניסיון" (same pattern for the other two)
- Then grep the frontend and the notification templates for `סוף 2026` and for `בחינם` next to a registration CTA. Report every remaining hit; change the user-facing ones the same way.

### Provider listing form subtitle (item 15)
"פרסום ללא עלות למנויים" → "המודעה נכללת במסלול שלך בקטגוריה". It contradicts the paid-per-category decision (R33 B).

**Acceptance P1:** before/after screenshots of `/how-it-works` and the home registration section; grep output showing zero `סוף 2026` in user-facing strings.

---

# Phase 2 · Provider business-number check (item 10)

Today (`user-org/app/routes/providers.py:104`, `register/provider/page.tsx:282`): required, format-only (9 digits), duplicate check across the three entity types, auto-activated. The copy in item 9 says "נבדק", so the check has to be real.

1. Add the Israeli ID / business-number check-digit validation (the standard Luhn-style algorithm used for ת.ז, ע.מ and ח.פ) on **both** server and client. Error copy: "מספר ח.פ / ע.מ אינו תקין. בדקו את הספרות." Server is the authority; the client check is UX only.
2. Unit tests: valid numbers, an off-by-one digit, all zeros, 8 digits with a leading zero padded.
3. Registry lookup for companies (ח.פ against the companies registry): **do not build in this round.** Report whether the existing `gov_registry_cache` plumbing used for contractors could serve it, and what it would take.
4. Existing providers: run the new check over current rows and report how many fail. Do not deactivate anyone.

---

# Phase 3 · Categories match our list (item 12) · needs R33 A1 deployed

Our list (the home chips, `app/page.tsx:1417`): ביטוח · הסעות · דיור לעובדים · ציוד וכלי עבודה · פיגומים · קורסים והסמכות.
Today in `marketplace_categories`: housing (דיור להשכרה) · equipment (ציוד וכלי עבודה) · services (שירותים) · other (כללי).

1. Migration (idempotent, data only, no ENUM):
   - Keep `housing`, rename `name_he` to "דיור לעובדים". It stays corporation-only (U8, R32 D1).
   - Keep `equipment` as is.
   - Insert `insurance` ביטוח · `transport` הסעות · `scaffolding` פיגומים · `courses` קורסים והסמכות. Codes and slugs are permanent.
   - `services` and `other`: report active listings and active subscriptions on each. If both are zero, set `is_active=false` (never delete). If not zero, **stop and report**; Yulian decides where they move.
   - `sort_order` follows the home chip order.
2. **No tiers and no prices in the migration.** Each new category gets zero tiers; R33's "אין מסלול פעיל" badge will show on it. Yulian adds the tiers and prices in `/admin/marketplace` (Manual actions).
3. The provider registration picker (R33 B.2) hides `housing` for providers entirely and shows categories without an active paid tier as unavailable.
4. Search: every home chip must return that category's listings through the federated pass. Add `search_synonyms` per category if the table has the column (e.g. הסעות: הסעה, הסעות עובדים, מיניבוס · קורסים והסמכות: קורס, הסמכה, הדרכה, עבודה בגובה · פיגומים: פיגום · ביטוח: ביטוח בריאות, חבות מעבידים). If the column does not exist, report and stop at the list.

---

# Phase 4 · Provider listing form (items 13, 14, 16)

## 4a · Layout (item 13)
`provider/marketplace/new/page.tsx` re-exports `corporation/marketplace/new/page.tsx`. The corporation shell has a sidebar; `provider/layout.tsx` has no shell, so the `max-w-2xl` form hugs the right edge with empty space beside it.
- Give `/provider/*` a proper shell: top bar with the logo, the provider's business name, and links to לוח בקרה · המודעות שלי · מנוי ותשלום · יציאה. Mobile: collapsible.
- Center the form (`mx-auto`), single column on mobile, two columns for short paired fields on desktop.
- Split the shared form into a provider form and a corporation form if that is cleaner than branching inside one file. Corporation housing behaviour must not change.

## 4b · Category choice (item 14)
- A provider sees only categories where it has an **active plan** (R33 B). Others show as locked with "הוספת מסלול בקטגוריה" linking to the R33 provider subscribe page.
- `housing` never appears for a provider, and `?category=housing` in the URL is ignored for a provider.
- One category with a plan → shown as a fixed chip, no picker.

## 4c · Fields per category (item 16)
Implement what was planned on 28.08 (`spec_services_housing_transport.md` §ג):
- `marketplace_categories.field_schema JSON NULL` · `marketplace_listings.attributes JSON NULL` (idempotent migration).
- Fields used to **filter in search** stay real columns: region(s), capacity. Everything else lives in `attributes`.
- The form renders the common fields, then the category's `field_schema`. The listing detail panel (R32 S5) renders `attributes` with the schema's labels.
- Server validates `attributes` against the schema (types, required, option lists); unknown keys rejected.
- Seed the schemas below in the Phase 3 migration. No admin field editor in this round.

**Common fields, every category:** title · description · service regions (multi-select of the existing regions, replaces the single city/region pair for providers) · contact name · contact phone · photos.

| Category | `field_schema` (key · label · type · options) | Price fields |
|---|---|---|
| `transport` | `vehicle_types` · סוגי רכבים · multi · מונית/ואן, מיניבוס (עד 19), אוטובוס · `max_passengers` · מספר נוסעים מקסימלי · int · `service_type` · סוג שירות · multi · הסעה קבועה יומית, משמרות, חד-פעמי · `nights_weekends` · עבודה בלילה ובשבת · bool · `licensed` · רישיון הסעות בתוקף · bool | `price_from` + unit: לנסיעה / ליום / לחודש |
| `insurance` | `insurance_types` · סוגי ביטוח · multi · ביטוח בריאות לעובדים זרים, חבות מעבידים, צד ג׳, עבודות קבלניות, ציוד מכני הנדסי · `insurers` · חברות ביטוח · text · `agent_license_no` · מספר רישיון סוכן · text · `service_languages` · שפות שירות לעובדים · multi (from the origins' languages) | none, shows "הצעת מחיר" |
| `equipment` | `equipment_type` · סוג ציוד · select · כלי עבודה חשמליים, גנרטורים, מערבלי בטון, במות הרמה, מלגזות, מיני מחפרון, אחר · `deal_type` · השכרה / מכירה · multi · `delivery` · הובלה · bool + `delivery_fee` int · `with_operator` · כולל מפעיל · bool · `certified_operator_required` · דורש מפעיל מוסמך · bool | `price_day` · `price_week` · `price_month` (each optional, at least one) |
| `scaffolding` | `scaffold_types` · סוגי פיגומים · multi · פיגום חזית, פיגום נייד, פיגום תלוי, אלומיניום · `services` · שירותים · multi · השכרה, מכירה, הרכבה ופירוק · `licensed_installer` · מתקין מורשה · bool · `engineer_supervision` · ליווי מהנדס · bool · `insured` · ביטוח לעבודה · bool | `price` + unit: ליחידה לחודש / למ״ר לחודש · `delivery_fee` |
| `courses` | `course_type` · סוג הקורס · select · עבודה בגובה, ריענון עבודה בגובה, מפעיל מלגזה, עגורן, נאמן בטיחות, עוזר בטיחות, אחר · `certifying_body` · גורם מסמיך · text · `duration` · משך · text · `languages` · שפות ההדרכה · multi · `delivery_mode` · מקום · multi · בכיתה, באתר הלקוח · `certificate_validity_months` · תוקף התעודה (חודשים) · int · `next_date` · מועד קרוב · date | `price` + unit: למשתתף / לקבוצה |
| `housing` (corporation only) | unchanged: the R32 / 28.08 fields (beds free of total, whole unit or beds, occupancy, last updated) | unchanged |

These field lists come from comparable Israeli and international listing sites. Transport and scaffolding fields are to be checked with one real provider each before they are frozen; keep them easy to change (data, not code).

**Acceptance P4:** screenshot of the form for each of the five provider categories at 390 and 1280 · a provider with a plan in one category sees only that category · `?category=housing` as provider is ignored · a listing created in each category shows its attributes in the detail panel · an invalid attribute is rejected by the server.

---

# Phase 5 · Provider area: plan, payment, numbers (item 17)

## 5a · Plan management
Under "מנוי ותשלום": per category, the plan, ads used of quota, renewal date, auto-renew on/off, upgrade, cancel, and "הוספת קטגוריה" (R33 B.3 page). During the promo show the promo end date and that no charge is made until then.

## 5b · Payment method
- Check what `/billing` already does for contractors and corporations (Cardcom token add / replace, invoices). If a reusable payment-method component exists, use it for providers.
- **If Cardcom tokenization or charging for `marketplace_subscriptions` does not exist, stop and report.** Do not build a payment integration in this round, and never store card data ourselves.

## 5c · Numbers on the provider dashboard
Today views and clicks are recorded only for sponsor ads (`events.py`, `promo_events`); provider listings record only contact reveals (`marketplace_reveals`); searches are not stored by category.
1. Extend the same event pipeline (same gates: allow-lists, IP rate limit, batch endpoint, size cap) with `target_type='marketplace_listing'` and event types `listing_impression` (card shown in results), `listing_open` (detail panel opened), `contact_reveal` (reuse `marketplace_reveals`, do not double count).
2. Search log: for each `/api/search`, store one row with the matched marketplace category codes and the region the rewriter extracted (no query text from anonymous users beyond what is already logged, no user id for anonymous). Purpose: "כמה חיפושים היו בקטגוריה שלך באזורים שלך".
3. Provider dashboard, last 30 days with a toggle to 7 days: per listing impressions, opens, reveals; totals; searches in the provider's categories and regions. Simple number tiles and one small trend line, design system colors.
4. Privacy: a provider sees only aggregates about its own listings and category demand. Never who viewed, never another provider's numbers.

**Acceptance P5:** events recorded for each type on staging · dashboard numbers match a direct SQL count for one listing · a second provider cannot read the first provider's numbers (API returns 403/404).

---

## Guardrails
- Do not touch: reveal billing for workers, `contact_reveals`, `subscription_plans` limits, the search ranking.
- Do not change corporation housing publishing.
- No new npm dependency without asking.
- No payment integration in this round (5b).

## Report
Per phase: what changed, file:line, evidence, screenshots. Phase 2 failure count. Phase 3 counts for `services` and `other`. `git diff -w --stat`.

**Manual actions (expected):**
1. Yulian adds tiers and prices for ביטוח, הסעות, פיגומים, קורסים והסמכות, ציוד וכלי עבודה in `/admin/marketplace`.
2. Yulian decides where `services` / `other` listings move, if any exist.
3. Yulian reviews the transport and scaffolding fields with one real provider each.
