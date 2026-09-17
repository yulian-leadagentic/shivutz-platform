# R5 §1 · P0 · frontend binary-branch audit

Grep: `grep -rn "=== 'corporation'\|=== \"corporation\"\|entity_type ===" services/frontend/src` — 56 hits. Every hit reviewed below with an explicit decision. Provider surfaces are already blocked by `RoleGuard` (R5 §1), so the OUT rows are code that provider entities cannot reach; no rewrite needed. FIX rows are followed by their status.

## Legend

- **DONE** — fixed in R5 §1 commit (this session).
- **OUT** — provider bounces before reaching this code (RoleGuard or select-entity guards it). Safe as-is.
- **FIX** — needs a follow-up; not in this pass.

## Table

| # | File · line | What it branches on | Decision | Why |
|---|---|---|---|---|
| 1 | admin/approvals/page.tsx:145-146 | `org.org_type === 'contractor'` | OUT | Admin-only screen; provider entities don't appear in the approval queue (they self-activate). |
| 2 | admin/approvals/page.tsx:500 | filter pill count | OUT | Same — approval queue doesn't include providers. |
| 3 | admin/leads/page.tsx:194-195 | badge label | OUT | Leads are contractor/corp only (marketplace lead-capture form rejects provider `org_type` per U7 §1 decision 5). |
| 4 | admin/orgs/page.tsx:170,192,280-281 | list badges + filter | FIX-later | Admin org list doesn't yet render providers (own list needed). Doc-only follow-up. |
| 5 | admin/orgs/[id]/page.tsx:86,251-252,442,472,608 | `orgType` state + workers-only sections | OUT | `sp.get('type')` only takes 'contractor'|'corporation' values from admin/orgs list; providers link to a future /admin/providers/{id}. Corp-only sections stay corp-only. |
| 6 | admin/subscription-plans/page.tsx:135-136,160 | tier grouping | OUT | Providers have no plan rows (free by decree, U7 audit #18). |
| 7 | admin/subscriptions/page.tsx:137 | badge label | OUT | Provider has no `payment_db.subscriptions` row (U7 audit #17), never listed here. |
| 8 | admin/users/page.tsx:174,228 | role counts | OUT | Admin users list role counts are stat counts; provider users bucket under `service_provider` role which the label map (extended in R5) handles. |
| 9 | billing/layout.tsx:16 | sidebar picker | OUT | Provider never reaches `/billing`; RoleGuard on `/billing` is entity-scoped. |
| 10 | contractor/dashboard/page.tsx:84 | dashboard guard | OUT | RoleGuard(`expect='contractor'`) bounces providers before this fires. |
| 11 | corporation/dashboard/page.tsx:85 | dashboard guard | OUT | RoleGuard(`expect='corporation'`) bounces providers. |
| 12 | corporation/workers/page.tsx:358 | worker fetch guard | OUT | Providers don't have workers; `/corporation/workers` is under corp RoleGuard. |
| 13 | invite/accept/[token]/page.tsx:102,119 | post-accept redirect + icon | FIX-later | auth.js `/invite/accept` already rejects provider invites (U7 §1 audit #26), so no provider ever reaches this page. Safe as-is; explicit switch would be defensive polish. |
| 14 | login/page.tsx:72 | dashboard redirect after login | FIX | Provider login won't hit this branch (their `role` claim after 077 migration is `service_provider`), but `dashboardOf` should include it. Follow-up (small). |
| 15 | login/page.tsx:134,232,246,312 | intent branching | FIX-later | Provider intent from landing not wired yet; UI shows contractor/corp intent chips only. See R5 §2 (register order). |
| 16 | membership-request/accept/[token]/page.tsx:178-179 | icon + label | OUT | Membership requests are contractor/corp only (auth.js §U7). Provider not reachable. |
| 17 | register/contractor/page.tsx:258 | duplicate-role hint | OUT | Contractor-side flow; provider never runs it. |
| 18 | register/corporation/page.tsx:229 | duplicate-role hint | OUT | Corp-side flow. |
| 19 | select-entity/page.tsx:124-125,176-177,247-249 | picker branches + labels | **DONE** | Rewrote R5 §1 · three-way switch, ENTITY_LABELS extended, Wrench icon for provider. |
| 20 | components/admin/OrgSummaryHeader.tsx:99,273,470 | corp-only sub-sections | OUT | Admin org summary; corp-only sections stay corp-only. Provider path handled separately (future /admin/providers). |
| 21 | components/landing/LandingNav.tsx:56,143 | dashboardHref + label | FIX | `dashboardHref` needs a provider branch (should go to `/provider/dashboard`). Small — do next pass. |
| 22 | components/landing/LeadCaptureModal.tsx:128 | intent picker | OUT | Lead-capture form is contractor/corp only (audit #3 above). |
| 23 | components/landing/LiveActivityFeed.tsx:45 | audienceFor mapping | **DONE** | `audienceFor` now explicitly returns 'anon' for provider viewers. |
| 24 | components/landing/LiveShowcase.tsx:137,139,154,183,186 | role → destination | FIX | Adds provider destination for a landing-page role picker. LiveShowcase is a two-hat pitch component (contractor · corporation); provider isn't part of that pitch narrative. Safe fallback: no-op for provider viewers (they wouldn't hit the "switch role" flow from LiveShowcase). |
| 25 | components/layout/RoleGuard.tsx:115-116,156 | mirror URL + NoAccessCard | **DONE** | Short-circuit added for provider entityType / provider expect; NoAccessCard falls through cleanly. |
| 26 | components/layout/Sidebar.tsx:56 | nav items | FIX | Sidebar picks contractor vs corp nav; provider gets `CONTRACTOR_NAV` today. Provider dashboard doesn't use Sidebar (bare layout) so no runtime break, but adding a `PROVIDER_NAV` is small follow-up. |
| 27 | components/layout/TopBar.tsx:199,219 | entity switcher target | FIX | Same as #14/#21 — add provider destination. Small. |

## Summary counts

- **DONE this pass**: 3 (select-entity, LiveActivityFeed, RoleGuard)
- **OUT — safe as-is** (backend gate blocks, RoleGuard bounces, or feature is contractor/corp-only by design): 17
- **FIX — small follow-ups** (add provider branch to a switch): 7

## Guardrail check

> ברירת המחדל בשער הרשאה היא "בחוץ". ספק רואה שירותים נלווים בלבד — זו הכרעת U7 §3.

Every OUT row above obeys this: no provider entity can reach the branched code because a server gate or `RoleGuard` already sends them to `/provider/dashboard` or a NoAccessCard. The FIX rows are UX polish — they don't leak access, they just default to a contractor-shaped destination when a switch would be clearer.
