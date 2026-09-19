# R12 · R13 · Manual QA round · 2026-09-19

Findings from Yulian's manual pass on staging + response.
Prompt R12: `docs/cc-prompts/cc_prompt_R12_manual_round.md` (superseded by R13 for §1).
Prompt R13: `docs/cc-prompts/cc_prompt_R13_search_model.md`.
Baselines: `pre-r12`, `pre-r13`.

## §1 · Search — R13 replaces R12 §1 · full visibility matrix

### The two prior mis-reads

1. **R12 §1 (first pass)** — read H12 as "corp/provider blocked from search."
   Built per-entity FE empty-states that treated search as workers-only. Yulian
   corrected: *"מה זה משנה כולם יכולים לחפש ולמצא תוצאות."*
2. **R12 §1 correction (second pass)** — reduced `viewer_scope_wheres` to
   `([], [])` for everyone and left `/api/search` behind the gateway auth gate.
   Yulian corrected again in R13: *"מה שהוחלט הוא לתת לכל מי שמאחורי לוגאין
   לחפש. רק קבלנים יכולים לראות מודעות של עובדים שמפורסמות ע״י תאגידים."* Two
   leaks: anon could suddenly see the full catalogue via any signed-in cookie
   dropping through, and corps saw rival worker inventory.

### The R13 matrix — locked

| Caller | worker ads | housing ads | marketplace |
|---|---|---|---|
| anonymous | ✗ | ✗ | ✓ |
| contractor approved | ✓ all | ✓ | ✓ |
| contractor `pending` | ✗ | ✗ | ✓ |
| corporation | own only | ✓ | ✓ |
| service_provider | ✗ | ✓ | ✓ |
| admin | ✓ | ✓ | ✓ |

### Backend changes

**`services/user-org/app/services/visibility.py`** — `viewer_scope_wheres`
reshaped per §2a with a new third arg `x_user_role`. Semantic changes vs the
pre-R12 baseline:
- `anonymous` (no `x_user_role`) → `(["1=0"], [])` — new gate required because
  `/api/search` is now public at the gateway.
- `service_provider` → `(["a.ad_type <> 'worker'"], [])` — was `1=0`; that
  1=0 was the bug that made provider search render nothing.
- `admin` (`x_user_role='admin'`) → `([], [])` — new branch so an admin
  without an entity context doesn't fall into the anon 1=0.
- `corporation` unchanged (`(a.ad_type <> 'worker' OR a.owner_entity_id = %s)`).
- `contractor` unchanged (`([], [])`) — pending status handled in search.py.

Also added `contractor_approval_status(x_entity_id)` — one-column read used
only by search.py to distinguish "approved contractor scope" from "pending
contractor scope" without turning viewer_scope_wheres into a query runner
for the four sibling public feeds.

**`services/user-org/app/routes/search.py`** — `require_contractor_approved`
removed **from search only**. Pending contractor now returns `200` with a
`1=0` appended to the scope (mirrors the L2 rule the four sibling feeds
still enforce as 403). `x_user_role` header wired in. Response gains a
`viewer_approval_status` field so the FE can pick the right empty-state copy
without a second round-trip.

**`services/user-org/app/routes/ads.py`** — `public_featured`, `public_recent`,
`get_public_ad` each now accept `x_user_role` and pass it to
`viewer_scope_wheres`. `require_contractor_approved` stays on all three per
the §3 guardrail.

**`services/gateway/src/index.js`** — `/api/search` added to `PUBLIC_PREFIXES`.
Nothing else opened. Identity headers still ride through the existing
"public route, caller IS logged in" block at line 345, so a corp searching
via the public path still gets its scope-narrowing predicate applied
downstream.

### Frontend changes — `services/frontend/src/app/page.tsx` + `src/lib/api/search.ts`

- Removed the `if (!isLoggedIn()) redirect to /login` block in `runSearch` —
  anon now hits `/api/search` directly.
- Four empty-state variants in the workers block, matching §4:
  - **anonymous** → brand-orange conversion prompt "התחבר כדי לראות מודעות
    עובדים ודיור" + orange "התחברות" button linking to
    `/login?returnTo=/?q=<query>`.
  - **pending contractor** → amber "החשבון שלך עדיין בבדיקה · ברגע שנאשר את
    החשבון תראה כאן את כל מודעות העובדים."
  - **corporation** → R12 §1c slate panel "מודעות עובדים של תאגידים אחרים
    אינן מוצגות לתאגידים · אלה המודעות שלך שתואמות לחיפוש — כרגע אין" + orange
    "פרסמו מודעת עובדים חדשה" CTA linking to `/corporation/ads/new/worker`.
  - **approved contractor + provider + admin** → existing amber "לא נמצאו
    מודעות התואמות" block, gated by all-3-empty (R5 §4).
- `ViewerApprovalStatus` type added to `SearchResponse`.
- Counter fix from R12 §1b unchanged — visible readout sums exact + near +
  marketplace.

### Reveal endpoint — untouched (§3 guardrail)

`/ads/{id}/contact-reveal` still gates on:
- `require_no_service_provider` — 403 for provider.
- Contractor approval — 403 for pending/rejected/suspended.
- Subscription entitlement — 402 for no subscription.
- Monthly reveal quota — 402 when cap exceeded.

That's the actual per-role restriction the product intends. R13 does not
weaken it in any way.

### Files touched

- [services/user-org/app/services/visibility.py](services/user-org/app/services/visibility.py)
- [services/user-org/app/routes/search.py](services/user-org/app/routes/search.py)
- [services/user-org/app/routes/ads.py](services/user-org/app/routes/ads.py) — 3 public-feed signatures
- [services/gateway/src/index.js](services/gateway/src/index.js) — one PUBLIC_PREFIXES entry
- [services/frontend/src/lib/api/search.ts](services/frontend/src/lib/api/search.ts)
- [services/frontend/src/app/page.tsx](services/frontend/src/app/page.tsx)
- [services/frontend/src/app/layout.tsx](services/frontend/src/app/layout.tsx) — build-tag `2026-09-19-r13-matrix`

### Live acceptance — 6-identity matrix

Direct HTTP against the backend (build-tag `2026-09-19-r13-matrix` served
17:12 IDT), one row per identity. `viewer_approval_status` is the new
response field the FE reads to pick the correct workers-block copy.

| Caller | `רצפים` → results / market | `ביטוח` → results / market | `viewer_approval_status` |
|---|---|---|---|
| **1 · anonymous** | 0 / 0 | 0 / 4 | `null` |
| **2 · admin (Yulian)** | 1 / 0 | 14 / 4 | `null` |
| **3 · contractor approved** (`73ac1629`) | 1 / 0 | 14 / 4 | `approved` |
| **4 · contractor pending** (temp flip of `18df8bfc`) | 0 / 0 | 0 / 4 | `pending` |
| **5 · corp `עליונים`** (no own flooring ad) | 0 / 0 | 0 / 4 | `null` |
| **6 · corp `כוח אדם`** (own flooring ad) | 1 / 0 | 5 / 4 | `null` |
| **7 · service_provider** | 0 / 0 | 0 / 4 | `null` |

`רצפים` marketplace = 0 for everyone because no `marketplace_listings` row
matches the query — services table doesn't sell flooring. `ביטוח` marketplace
= 4 across the board — anon + contractor pending + service_provider all
receive it, proving `_search_marketplace` runs unconditionally.

Also verified `rejected` and `suspended` contractor statuses — both echo
their status in `viewer_approval_status` and get `results=0`, marketplace
still flows. The FE branches on `!== 'approved'` so all three failure
statuses render the same "החשבון שלך עדיין בבדיקה" copy.

### §3 · reveal-not-broken · gateway-level

| test | expected | actual |
|---|---|---|
| anon `GET /api/ads/{id}/contact-reveal` | 401 | **401** ✓ |
| anon `GET /api/ads/{id}` | 401 | **401** ✓ |
| anon `GET /api/ads/public/recent` | 401 | **401** ✓ |
| anon `GET /api/ads/public/featured` | 401 | **401** ✓ |
| pending contractor `GET /public/featured` | 403 (require_contractor_approved) | **403** ✓ |
| anon `POST /api/search` | 200 | **200** ✓ |
| anon `POST /api/search q=ביטוח` marketplace count | 4 | **4** ✓ |

The reveal path is untouched — a corp/provider that manages to sign in
still hits `require_no_service_provider` + `require_contractor_approved`
on `contact_reveal`; the R13 policy correction only affected which
callers see the ads at all in the search list.

### Guardrails

- H12 corp anti-enumeration RE-AFFIRMED — corp predicate identical to pre-R12.
- Reveal endpoint untouched.
- `require_contractor_approved` removed **from search only**; still enforced on
  `public/featured`, `public/recent`, `public/{id}`, `contact-reveal`.
- Only `/api/search` opened in gateway — `/api/ads/{id}`, `/api/reveals`,
  `/api/corporations/*` all still closed.
- `git rev-list --left-right --count origin/staging...origin/pivot/v2` → `0 0`.

---

## §2 · §3 · §4 · §5 of R12 prompt — still pending

Not started. R13 addressed §1 exclusively.
