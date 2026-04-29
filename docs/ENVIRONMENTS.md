# Environments — current operational status

Single source of truth for **how each environment runs today** (as of 2026-04-29). Read this before:
- Picking which environment to deploy to
- Debugging why a request doesn't reach the right place
- Onboarding a new contributor (or a new Claude session)

For setup history and Railway-specific gotchas see [RAILWAY_DEPLOYMENT.md](./RAILWAY_DEPLOYMENT.md). For the per-env env-var matrix see [RAILWAY_SECRETS_CHECKLIST.md](./RAILWAY_SECRETS_CHECKLIST.md).

---

## Three environments

| | Local Docker | Staging | Production |
|---|---|---|---|
| Where | Your laptop | Railway | Railway |
| Branch | working tree | `staging` | `main` |
| Auto-deploy | `docker-compose up` | push to `origin/staging` | push to `origin/main` |
| Frontend URL | `http://localhost:3008` | `https://frontend-staging-3206.up.railway.app` | `https://frontend-production-d7cd.up.railway.app` |
| Gateway URL | `http://localhost:3000` | `https://gateway-staging-3a12.up.railway.app` | `https://gateway-production-7e86.up.railway.app` |
| MySQL | `mysql:3306` (compose) | `mysql.railway.internal:3306` (staging plugin) | `mysql.railway.internal:3306` (prod plugin) |
| Redis | `redis:6379` (compose) | `redis.railway.internal:6379` (staging plugin) | `redis.railway.internal:6379` (prod plugin) |
| RabbitMQ | `rabbitmq:5672` (compose) | `rabbitmq.railway.internal:5672` (staging container) | `rabbitmq.railway.internal:5672` (prod container) |
| Login | `MASTER_OTP=999999` (in `.env`) | `MASTER_OTP=999999` (env var on auth) | Real SMS only — no master code |
| Seed admin | Whatever's in your local DB | `+972525278625` (Yulian Abramovich) | `+972525278625` (Yulian Abramovich) |
| Data state | Your dev fixtures | Empty (only seed admin) | Empty / minimal (no live users yet) |
| Cardcom | `PAYMENT_FAKE_MODE=1` | `PAYMENT_FAKE_MODE=1` | `PAYMENT_FAKE_MODE=1` (until creds in) |
| SMS provider | Configured per `.env` | `vonage` | `vonage` (waiting for account budget) |
| SendGrid | not configured | not configured | not configured (waiting for domain) |

The Railway hostnames `*.railway.internal` are identical strings across envs — Railway's per-env DNS resolves them to the right plugin. Don't try to "fix" the duplication.

---

## Local Docker

### Quick start

```
docker-compose up -d            # starts all 9 backends + mysql + redis + rabbitmq + frontend
docker-compose logs -f auth     # follow logs for one service
docker-compose down             # stop everything (volumes persist)
docker-compose down -v          # stop AND wipe volumes (fresh DB)
```

### Per-service ports (host)

| Service | Port |
|---|---|
| frontend | 3008 |
| gateway  | 3000 |
| auth | 3001 |
| user-org | 3002 |
| worker | 3003 |
| job-match | 3004 |
| deal | 3005 |
| notification | 3006 |
| admin | 3007 |
| payment | 3009 |
| RabbitMQ AMQP | 5672 |
| RabbitMQ UI | 15672 |

MySQL has no host port binding — reach it from inside the network.

### `.env` — local secrets

Lives in repo root, gitignored. **Must include** `MASTER_OTP=999999` for OTP-bypass login (the security fix from 2026-04-29 removed the hardcoded fallback in code, so `999999` only works when the env var is explicitly set).

If `MASTER_OTP` isn't in your `.env`, you'll need a real SMS code — and your local SMS provider is probably `stub`, which only logs to stdout. Check `docker-compose logs auth` for the OTP code if so.

### Migrations on local

Local Docker mounts `db/migrations/` into the MySQL container's `docker-entrypoint-initdb.d/`. Runs all `*.sql` files **once on first MySQL boot only**. If you change a migration after first boot, wipe with `docker-compose down -v` and `docker-compose up`.

(This differs from Railway, where the runner script is idempotent and applies new migrations on every boot.)

---

## Staging on Railway

### Purpose

Mirror of production for QA. Real Railway infrastructure, isolated DB, master-OTP login allowed for fast iteration. Use this to validate any change before shipping to prod.

### Login

1. Go to `https://frontend-staging-3206.up.railway.app/`
2. Phone: `+972525278625` (the seed admin)
3. OTP: `999999` (MASTER_OTP bypass)
4. Lands in admin dashboard with empty data.

### Branch flow

```
staging branch ──→ origin/staging ──→ Railway staging env ──→ live in <2 min
```

Push to `staging` to deploy. No manual redeploy needed; Railway auto-deploys on push.

### What's configured

- All 13 services live (frontend + gateway + 8 backends + admin + payment, plus 3 plugins)
- Each service explicitly references the staging plugin (chip bindings, not literal text)
- JWT secrets, TOKEN_ENCRYPTION_KEY, CARDCOM_WEBHOOK_SECRET — fresh, distinct from prod
- Vonage credentials shared with prod (cost concern is small for staging volume)

### Known constraints

- Vonage account is shared with prod — staging tests count against the same budget. Switch to `SMS_PROVIDER=stub` on staging auth + notification if you want fully free SMS.
- Cardcom is in `PAYMENT_FAKE_MODE=1` — payment flows simulate J5 holds, no real money.
- SendGrid isn't configured anywhere — magic-link / admin-alert emails fail silently.

### Wiping staging data

When tests pollute staging DB and you want a clean slate:
1. Railway → staging env → MySQL plugin → mysql-volume → **Wipe Volume** (this is a separate option from "Delete Service" — make sure you're on the volume, not the service)
2. Re-set `SEED_ADMIN_PHONE` + `SEED_ADMIN_NAME` on user-org (delete them after first boot to avoid clutter)
3. Redeploy user-org → migrations rebuild + admin re-seeds

---

## Production on Railway

### Purpose

Real users. Real money flows once Cardcom is wired. **No master-OTP bypass** — only legitimate SMS-OTP login.

### Login

1. Go to `https://frontend-production-d7cd.up.railway.app/`
2. Phone: `+972525278625` (the seed admin) — or whatever real user phone
3. Vonage sends an SMS with the OTP (when budget is funded)
4. Enter the real code → lands in admin dashboard

### Branch flow

```
main branch ──→ origin/main ──→ Railway production env ──→ live in <2 min
```

Push to `main` to deploy. **Don't push to main directly** — go via staging first (see [Workflow](#workflow-staging-first-then-main) below).

### Open items before production is fully usable

| Item | Status | Action |
|---|---|---|
| Vonage budget | unfunded | Add credits to Vonage account → real SMS works |
| Cardcom credentials | not provisioned | Get prod terminal + creds from Cardcom → set vars on payment, flip `PAYMENT_FAKE_MODE=0` |
| SendGrid | not provisioned | Verify domain at SendGrid → set `SENDGRID_API_KEY` on notification |

---

## Workflow: staging-first, then main

```
git checkout staging
git pull
# ...edit code, run local tests via docker-compose...
git commit -m "feat: ..."
git push origin staging         # → staging env deploys
# manually QA on the staging URL
# happy → ship to prod:
git checkout main
git merge staging
git push origin main            # → production env deploys
git checkout staging            # back to working branch
```

**Hotfix exception** — for an urgent prod fix:
```
git checkout main
git commit -m "fix: ..."
git push origin main
git checkout staging
git merge main                  # immediately backport so branches don't drift
git push origin staging
```

**Rules:**
- Default branch to live on: `staging`. Treat `main` as ship-only.
- Never let `staging` and `main` drift more than a day or two — merge them in either direction.
- Migrations especially: always run on staging first. A failed migration on staging is recoverable; on prod it can lock the deploy.

---

## Deleted artifacts (don't recreate)

- `master` branch — deleted 2026-04-29. Was a leftover initial branch with no unique commits.
- Any `${{shared.*}}` variables at the project level — removed during prod debugging. Use `${{Plugin.VAR}}` references on each service instead.
