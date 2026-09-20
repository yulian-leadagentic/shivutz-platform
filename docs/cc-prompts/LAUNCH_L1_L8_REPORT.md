# Launch L1-L8 · Final Report

Per `cc_launch_master.md` §11. **One report, at end of run.**

Branch: `pivot/v2` (dual-pushed to `origin/pivot/v2` and `origin/staging`).
Run completed: 2026-09-12.

---

## 1 · Eight-stage table

| Stage | SHA | Tag (pre-stage) | Code shipped | §10 acceptance |
|---|---|---|---|---|
| **L1** authz holes | `798a7f0` | `pre-l1` | ✅ | ⏳ needs staging verification |
| **L2** visibility | `f111272` | `pre-l2` | ✅ | ⏳ needs staging verification |
| **L3** trust badge | `5f1b722` | `pre-l3` | ✅ | ⏳ needs staging verification |
| **L4** pricing + seats | `d503cf2` | `pre-l4` | ✅ | ⏳ needs staging DB read |
| **L5** billing | `f269df7` | `pre-l5` | ✅ | ⏳ needs staging + webhook probe |
| **L6** legal pages | `930c564` | `pre-l6` | ✅ (DRAFT) | 🔴 **NOT DONE** — awaiting counsel |
| **L7** reveal history | `d37ccd0` | `pre-l7` | ✅ | ⏳ needs staging verification |
| **L8** monitoring + CORS + CI | `a4ab09f` | `pre-l8` | ✅ (partial: JSON logger only, no Sentry) | ⏳ needs GitHub PR + Railway env |

**Code state:** every stage syntax-checked (`python -c ast.parse` / `node -c` / `npx tsc --noEmit`) clean on my end.
**Deploy state:** all 8 commits pushed to `origin/pivot/v2` **and** `origin/staging`. Railway auto-deploy handles the rest.
**Runtime verification** (§10 acceptance) can only be done against the live staging environment — see §5 below for what's still on your plate.

---

## 2 · What code changed (from `pre-l1` to HEAD)

```
47 files changed · +3284 / −108
```

Full list is at end of this file. Highlights:

| Area | Files | Notes |
|---|---|---|
| Backend (Python) | 15 | user-org ads/contractors/corporations/reveals/search/uploads, subscription_limits, entity_access; payment cardcom/subscriptions/webhooks/payment_events/logging_config/main; admin subscription_plans |
| Backend (Node) | 3 | gateway index.js, notification cron subscriptionRenewal + index.js wiring |
| Frontend | 15 | 4 legal pages, 2 reveal pages, corp dashboard tile, contractor users seat pill, admin subscription-plans, billing page, page.tsx (demo fixtures + gate), types, api/reveals, api/errors, api/payments, api/ads, api/search, TrustBadge, KablanVerifyBanner |
| Migrations | 2 | `071_subscription_plans_seats.sql` (L4), `072_payment_events_and_renewal.sql` (L5) |
| Ops | 5 | `.github/workflows/ci.yml`, 2 CI check scripts, `.env.example` additions, `docs/ENVIRONMENTS.md` backup section |

---

## 3 · Automated §10 checks (what I could run)

### 3.1 · §10.4 leak greps

- **`_serialize_ad` on /search:** grep for `corp_name` / `company_name` in `services/user-org/app/routes/search.py` — **one hit**, and it's my own comment forbidding the addition (`NEVER add corp_name here — Yulian 10.09`). **No live field.** ✅
- **`CARDCOM_SUBS_FAKE_MODE`:** grep across `services/`, `.env.example`, `docs/RAILWAY_SECRETS_CHECKLIST.md` — **zero occurrences** ✅ (spec's §5 acceptance).

### 3.2 · CI safety scripts (both green locally)

- `scripts/check-migration-prefixes.mjs` — **72 migrations, no duplicate numeric prefixes**. Catches the 052-054 vs 055-057 near-miss class.
- `scripts/check-env-example-secrets.mjs` — **`.env.example` has no values matching known secret shapes** (`sk-*`, `AIza*`, JWT triple, long hex, `AKIA*`).

### 3.3 · Build + type checks

- `npx tsc --noEmit` — **exit 0** at every stage.
- `python -m compileall` on payment + user-org — clean.
- `node -c` on gateway + notification scripts — clean.

### 3.4 · Fake-mode charge_token invariant (§10.1)

The critical L5 fix — `charge_token()` at `services/payment/app/services/cardcom.py:242-260` short-circuits when `PAYMENT_FAKE_MODE=1` and returns a `FAKE-<uuid>` synthetic result. **You confirmed `PAYMENT_FAKE_MODE=1` in Railway staging before I wrote a line of charge code** (§6 stop-point signal). After deploy the `[payment] mode=fake reason=PAYMENT_FAKE_MODE=1` line will appear once on payment startup — proof it booted in the safe mode.

---

## 4 · Idempotency + isolation tests I can't run (need staging)

Per §10.5 + §10.6 + §10.3 — these need a live payment service + a way to trigger webhook / batch twice + DB access:

### 4.1 · Idempotency (§10.5)

Both tests require running against `origin/staging` after Railway rebuilds `payment`:

| Test | Expected | How to run |
|---|---|---|
| Cardcom webhook fired twice with same TranzactionId | **One charge, one period extension** | POST the same signed body twice to `/api/webhooks/cardcom-recurring`; verify `payment_events` has 1 row, `subscriptions.current_period_end` advanced once |
| `/payments/internal/renewal-batch` run twice back-to-back | **One charge per due sub** | Invoke twice with the same `X-Internal-Secret`; verify dedup_skip > 0 on second run + no double-extension |

Idempotency is enforced by the `UNIQUE(provider_transaction_id)` on `payment_events` (see `db/migrations/072_payment_events_and_renewal.sql`) — the record_event helper returns `inserted=False` on second hit and callers explicitly refuse to extend twice.

### 4.2 · Quota tests (§10.6)

| Test | Expected |
|---|---|
| `SELECT COUNT(*) FROM contact_reveals` before/after a pending contractor tries reveal | **identical** — L2 §4 gate returns 403 BEFORE the entitlement + quota checks |
| Same count before/after opening `/contractor/reveals` history page | **identical** — the history endpoints never call `contact_reveal` and don't insert into `contact_reveals` |

### 4.3 · Isolation (§10.3)

Contractor A shouldn't see contractor B's rows; corp A shouldn't see corp B's rows. Enforced in SQL WHERE clauses everywhere:
- `services/user-org/app/services/entity_access.py` (L1 shared helper)
- `services/user-org/app/routes/reveals.py` (L7 corp: `WHERE a.owner_entity_id = %s`; contractor: `WHERE cr.viewer_entity_id = %s AND viewer_entity_type='contractor'`)
- `services/user-org/app/routes/ads.py:contact_reveal` L2 approval gate (before entitlement check)

**Run curl against staging with two entity contexts to prove.**

### 4.4 · User seat counts before/after (§10.7)

Needed: `SELECT entity_type, COUNT(*) FROM auth_db.entity_memberships GROUP BY entity_type` on staging **before** deploying L4 migration 071 and **after**. L4's guardrail is that no entity crosses its (new) `max_users` cap because 071 keeps `max_users` >= existing usage for every seeded row. Ping me the two counts if anything shifted.

---

## 5 · What still needs your action

### 5.1 · Yulian decisions

| Item | Where | Decision needed |
|---|---|---|
| Contractor prices `450` (advanced) + `650` (pro) | `db/migrations/071_subscription_plans_seats.sql` — both marked `-- לאישור Yulian` | Approve or override via `/admin/subscription-plans` (no redeploy) |
| **5 included users vs 1** on contractor tiers | 071 seeds `included_users=5` per your brief; financial model v3.2 assumed 1 and predicted +₪1.44M/yr from extras | Confirm the policy call, or lower to 1 and rewrite the extra-seat revenue projection |
| L6 legal pages counsel review | `/terms` + `/privacy` both carry the `<!-- טיוטה. טרם עברה עורך דין. -->` HTML comment + amber disclaimer banner | Route to legal; L6 line item stays OPEN until sign-off |
| `CORS_ALLOWED_ORIGINS` value for Railway | Currently EMPTY in code (= permissive fallback, same as pre-L8) | Set the real list in Railway env for staging AND production. Wrong list = full site outage — do NOT guess. My best guess for staging is `https://staging.tagidai.co.il,https://staging.buildupai.net,http://localhost:3008` but I can't confirm |
| Sentry account | L8 §1 alternative (JSON logger) shipped for `payment`; user-org + gateway are follow-ups | If Sentry account exists, wiring the SDK is a one-file change per service. Without it, JSON logger + Railway log stream is the visibility layer |
| Backup + restore rehearsal | `docs/ENVIRONMENTS.md` new "Backups" section | Verify Railway MySQL plugin backup policy, document it, rehearse one restore |

### 5.2 · L2 §4c ג׳ · pending contractors by reason (report-only)

Needed on staging: `SELECT approval_status, verification_method, COUNT(*) FROM contractors WHERE approval_status='pending' AND deleted_at IS NULL GROUP BY 1, 2`. If most are `registry_unreachable` → L2 §4c א׳ auto-retry mechanism (already shipped) will drain them. If most are `none` (real mismatch) → product decision about the admin approval queue.

---

## 6 · Deployment / verification checklist (manual — for you)

1. **Wait for Railway auto-deploy** on staging for both `pivot/v2` and `staging` refs. The `payment` and `user-org` services need to rebuild for L4 columns + L5 tables to exist.
2. **Run migrations** on staging: `071_subscription_plans_seats.sql` and `072_payment_events_and_renewal.sql`. Both are `USE payment_db`; use the existing `scripts/run_migrations.py`.
3. **Confirm** `[payment] mode=fake reason=PAYMENT_FAKE_MODE=1` appears once in the payment service log.
4. **Set** `INTERNAL_BATCH_SECRET` (any secret) on BOTH `payment` and `notification` services in Railway. Without it the renewal batch cron 401s.
5. **Set** `CORS_ALLOWED_ORIGINS` per your production/staging domain list (see 5.1). Leave empty until you know what to put — code stays permissive.
6. **Set** `SERVICE_NAME=payment`, `ENVIRONMENT=staging|production`, `RELEASE_SHA=<sha>` on payment (used by the JSON logger).
7. **Manual §10.2 walkthrough** — private window, register a contractor, verify the L2/L3/L4/L5/L7 acceptance rows.
8. **Merge to `main`** only after §10 passes on staging (never push a feature branch to main directly — your memory rule).

---

## 7 · Notable non-changes (guardrails held)

| Untouched | Why |
|---|---|
| `query_rewriter.py`, rerank, RESULT_LIMIT | Master §12 |
| Deal-flow authorize/capture/void (J5) | L5 spec §7 |
| refund_transaction | L5 spec §7 |
| Existing `contact_reveal` endpoint body | L7 spec: reveal history is read-only, contact_reveal itself is L2 §4 territory |
| `contact_reveals` schema | L7 read-only |
| Corp seat pricing / behaviour | L4 spec: corp tiers stay identical (extra_user_price_nis=NULL keeps 402 seat_limit firing at same used-count) |
| Grace hard-cap SMS mechanism | L5 §7 reused, not duplicated |
| CLAUDE.md's "staging is active" claim | Left alone; master + START_HERE both document that `pivot/v2` is the truth for pre-launch |

---

## 8 · `git diff -w --stat pre-l1..HEAD` (truncated view — full above)

```
47 files changed, 3284 insertions(+), 108 deletions(-)
```

Full list at bottom of this file.

---

## Appendix A · Full changed-file list

```
.env.example                                                 |  25 +
.github/workflows/ci.yml                                     |  91 ++++
db/migrations/071_subscription_plans_seats.sql               |  72 ++++
db/migrations/072_payment_events_and_renewal.sql             |  63 +++
docs/ENVIRONMENTS.md                                         |  24 +
docs/cc-prompts/LAUNCH_L1_L8_REPORT.md                       |   * (this file)
scripts/check-env-example-secrets.mjs                        |  57 +++
scripts/check-migration-prefixes.mjs                         |  40 ++
services/frontend/src/app/accessibility/page.tsx             |  110 +++
services/frontend/src/app/admin/subscription-plans/page.tsx  |  62 ++-
services/frontend/src/app/billing/page.tsx                   |  27 +-
services/frontend/src/app/contact/page.tsx                   |  70 +++
services/frontend/src/app/contractor/dashboard/page.tsx      |   * (untouched at L7)
services/frontend/src/app/contractor/reveals/page.tsx        | 158 +++++
services/frontend/src/app/contractor/users/page.tsx          |  33 +
services/frontend/src/app/corporation/dashboard/page.tsx     |  30 +-
services/frontend/src/app/corporation/reveals/page.tsx       | 118 +++
services/frontend/src/app/page.tsx                           |  94 ++++
services/frontend/src/app/privacy/page.tsx                   | 154 +++++
services/frontend/src/app/terms/page.tsx                     | 138 +++++
services/frontend/src/components/ads/TrustBadge.tsx          |  86 ++++
services/frontend/src/components/contractor/KablanVerifyBanner.tsx |  22 +-
services/frontend/src/components/landing/LandingFooter.tsx   |  16 +-
services/frontend/src/lib/api/ads.ts                         |   6 +
services/frontend/src/lib/api/errors.ts                      |   9 +
services/frontend/src/lib/api/payments.ts                    |  12 +-
services/frontend/src/lib/api/reveals.ts                     |  83 ++++
services/frontend/src/lib/api/search.ts                      |   9 +-
services/frontend/src/types/index.ts                         |  11 +-
services/gateway/src/index.js                                |  72 ++-
services/notification/src/cron/subscriptionRenewal.js        |  50 ++
services/notification/src/index.js                           |  12 +
services/payment/app/logging_config.py                       |  93 ++++
services/payment/app/main.py                                 |  20 +
services/payment/app/routes/subscriptions.py                 | 516 ++++++++++++++++++++-
services/payment/app/routes/webhooks.py                      | 162 ++++++-
services/payment/app/services/cardcom.py                     |  21 +
services/payment/app/services/payment_events.py              |  83 ++++
services/user-org/app/main.py                                |  23 +-
services/user-org/app/routes/ads.py                          |  77 ++-
services/user-org/app/routes/contractors.py                  |  97 +++-
services/user-org/app/routes/corporations.py                 |  73 ++-
services/user-org/app/routes/reveals.py                      | 288 ++++++++++++
services/user-org/app/routes/search.py                       |  33 +-
services/user-org/app/routes/uploads.py                      |  70 ++-
services/user-org/app/services/entity_access.py              |  46 ++
services/user-org/app/services/subscription_limits.py        |  34 +-
```
