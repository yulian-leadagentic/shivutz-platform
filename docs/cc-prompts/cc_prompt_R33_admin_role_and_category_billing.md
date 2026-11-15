# CC prompt · R33 · Admin permission fix, paid service categories, small copy fix

**Date:** 15.11.2026 · **Owner:** Yulian · **Branch:** the deploy branch you confirmed in R32

## STANDING RULE

`git tag pre-r33` before the first change. One commit per item, in the order below. A1 first: Yulian cannot manage categories until it lands, and B depends on him being able to add tiers.

---

## A1 · Admin actions fail with `admin_only` while the UI says "מנהל מערכת" 🔴

**What Yulian sees (staging, 15.11):** `/admin/marketplace` shows a red `admin_only` banner, the category list is empty (the categories do exist, they show on the home page chips), and saving a new category fails with `admin_only`. The header shows "מנהל מערכת".

**Root cause (read from code, confirm on staging):**
- The gateway admits admin routes on `user.role === 'admin'` (`gateway/src/index.js`, `ADMIN_ONLY` check).
- It then projects `x-user-role = user.entity_type || user.role` (`attachUserHeaders`, ~`:337`).
- The "מנהל מערכת" tile on `/select-entity` only routes to `/admin/dashboard` (`select-entity/page.tsx:231–250`). It does **not** clear the entity context. A multi-membership admin who picked an entity earlier keeps `entity_type` in the JWT.
- So the gateway lets the request through, and the backend sees `x-user-role = corporation` (or `contractor`) and refuses: `marketplace_admin.py:_require_admin` checks `x_user_role != "admin"`.
- Admin screens served by the `admin` service work, because they rely on the gateway check only. Screens served by `user-org` and `deal` break.

**Blast radius, every backend admin check that reads the projected header** (grep, do not trust this list):
`user-org`: `marketplace_admin.py:24` · `contractors.py:585` · `events.py:312` · `uploads.py:54` · `marketplace.py:793` · `entity_access.py:39` · `notification_recipients.py:54` · `team_membership.py:44` · `visibility.py` (3) · `search.py:569`
`deal`: `tenders.py` (≥8 sites: admin publish, confirm winner, admin read of any tender)

The `deal/tenders.py` sites mean **admin actions on import requests are likely broken the same way**. Check and report.

**Fix:**
1. Gateway: in `attachUserHeaders`, add `x-user-is-admin: 1` when `user.role === 'admin'`, delete it otherwise. Add it to the ingress strip list in `stripIdentityHeaders.js` so a client can never send it.
2. Backend: one helper per service, `is_admin(x_user_is_admin, x_user_role) -> bool` = `x_user_is_admin == "1" or x_user_role == "admin"`. Replace every admin check in the blast radius with it.
3. **Do not change what non-admin checks see.** `x-user-role` keeps meaning "the entity I am acting as". An admin acting as a corporation in a corporation screen is a corporation there. The new header is read only where the code asks "is this an admin".
4. Security note: `GET /api/marketplace*` is public by method, so `GET /api/marketplace/admin/*` skips the gateway's `ADMIN_ONLY` check and relies on the backend alone. Keep the backend check (now via `is_admin`), and also make the gateway apply `ADMIN_ONLY` before the public-method shortcut. Report whether any other admin GET path is public by method.

**Acceptance A1:**
- [ ] As Yulian's real admin user, after picking a corporation and then the admin tile: `/admin/marketplace` lists the existing categories, creating and editing a category and a tier works
- [ ] Same user: admin publish and admin confirm-winner on an import request work
- [ ] Non-admin corporation user: every one of those endpoints still returns 403
- [ ] A request with a spoofed `x-user-is-admin: 1` header and a non-admin token is refused

## B · Service categories are paid, per category, also during the launch promo

**Decision (Yulian, 15.11):** a service provider can publish in a category only while it has an **active plan in that category**. Every category has its own price. During the launch promo the price paid may be 0, but the listing must still be linked to an active plan.

**Today's state (read from code):**
- `marketplace.py` create_listing: `is_provider_free` (U7, 14.09) lets a provider publish in any non-housing category with **no** subscription check and `subscription_id = NULL`.
- `providers.py` (R10, 20.09) creates a `marketplace_subscriptions` row at registration for the picked tier (promo row with `price_paid 0` and `promo_note='launch_free_promo'`), but nothing at posting time ever reads it.
- `/register/provider` lets a provider through when the category has **no active tiers** (R10 §1 guardrail).
- Corporations have `/corporation/marketplace/subscribe` ("רכישת מנוי לשירותים נלווים"), though a corporation may publish only housing, free (U8, Yulian 14.09).

**Changes:**
1. **Remove the `is_provider_free` bypass.** A provider goes through the same subscription-and-slot path contractors use today (active `marketplace_subscriptions` row in `body.category`, slot available, `subscription_id` written on the listing). Keep the provider category guard (no housing, no worker). Corporation housing stays free, unchanged.
2. **Registration:** a category with no active paid tier cannot be picked. Remove the "let it through" guardrail and show the category as unavailable with a short reason.
3. **Provider can add a category later:** a provider-side page to buy a plan in another category (reuse the logic of `/corporation/marketplace/subscribe`, new route under `/provider/marketplace/subscribe`). During the promo the purchase creates a promo row exactly like registration does. After the promo: if Cardcom charging for `marketplace_subscriptions` already exists, use it; if it does not, **stop and report**, do not build payment in this round.
4. **Remove the corporation subscribe page** and its two links in `/corporation/marketplace/page.tsx` (`:112`, `:146`). Redirect the route to `/corporation/marketplace`.
5. **Backfill, so nothing disappears on deploy:** for every provider with active listings in a category where it has no active subscription, create a promo subscription row in that category (cheapest active tier, `promo_note='r33_backfill'`, `expires_at` = the promo end date) and link those listings to it. Dry-run first and report the counts per category before writing.
6. **Admin clarity:**
   - `/admin/marketplace` header text becomes: "כאן נקבעות הקטגוריות של השירותים הנלווים ומחיר כל מסלול. ספק שירות יכול לפרסם בקטגוריה רק כשיש לו מסלול פעיל בה."
   - A category with no active paid tier shows a visible warning badge "אין מסלול פעיל, ספקים לא יכולים לפרסם כאן".
   - Admin nav labels: "מסלולי מנוי · קבלנים ותאגידים" and "שירותים נלווים · קטגוריות ומחירים". Keep the existing pointer line on `/admin/subscription-plans`.

**Acceptance B:**
- [ ] Provider with no plan in category X: publishing in X returns 402 with a message that links to the buy page
- [ ] Provider with an active promo plan in X: publishes, listing has `subscription_id` set, slot count decreases
- [ ] Slots exhausted: 402, existing listings unaffected
- [ ] Corporation housing: still free, still works
- [ ] Backfill dry-run counts, then the real run, then: zero active provider listings with `subscription_id IS NULL`
- [ ] List of staging categories with no active paid tier (Yulian adds tiers after A1 lands)

## C · Copy fix on the corporation import-requests page

`corporation/tenders/page.tsx`:
- `:119` "בקשות פתוחים להצעה" → **"בקשות פתוחות להצעה"**
- empty state "אין כרגע בקשות פתוחים שטרם הגשת אליהם הצעה." → **"אין כרגע בקשות פתוחות שטרם הגשת אליהן הצעה."**

Grep the frontend for "בקשות פתוחים" and fix any other occurrence.

---

## Guardrails

- Do not touch reveal billing, `contact_reveals`, `subscription_plans` limits, the search pipeline.
- A1 must not widen any non-admin permission. If a check you are replacing also served a non-admin path, stop and report.
- B: no new payment integration in this round (see B.3).

## Report

Per item: what changed, file:line, evidence. The A1 blast-radius table (site · before · after · tested). B dry-run counts. `git diff -w --stat`.

**End with "Manual actions"**: at minimum, Yulian adds paid tiers to every category listed as having none, after A1 is deployed.
