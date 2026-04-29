# Railway Deployment

Shivutz runs on Railway as a **single project with two environments**
(`production` and `staging`). Each environment owns its own MySQL, Redis,
RabbitMQ, and 10 services — fully isolated.

```
Railway project: Shivutz
├── Environment: production              ← deploys from main
│   ├── frontend       (Next.js, public)
│   ├── gateway        (Node, PUBLIC — the API entrypoint, also handles Cardcom callbacks)
│   ├── auth           (Node, private)
│   ├── user-org       (Python, private, persistent volume for uploads)
│   ├── worker         (Python, private)
│   ├── job-match      (Go, private)
│   ├── deal           (Python, private)
│   ├── notification   (Node + cron, private)
│   ├── admin          (Python, private)
│   ├── payment        (Python, private — reached via gateway)
│   ├── MySQL          (Railway plugin — 7 schemas inside)
│   ├── Redis          (Railway plugin)
│   └── RabbitMQ       (own container)
└── Environment: staging                 ← deploys from staging
    ├── (same 10 services + 3 plugins, independent data, weaker secrets)
```

Why this layout:
- One MySQL plugin per env hosts all 7 logical schemas (auth_db, org_db,
  worker_db, job_db, deal_db, notif_db, payment_db). The platform uses
  cross-DB JOINs heavily — splitting schemas across separate plugins
  would break those.
- Production and staging each get their own MySQL/Redis/RabbitMQ →
  experimental migrations + test data never touch real users.
- Staging can be scaled down independently.

> Modeled on the Planwise deployment in
> `C:/Users/yulia/Planwise/docs/RAILWAY_DEPLOYMENT.md`. The biggest
> differences are: 10 services instead of 2, 7 schemas in one DB,
> RabbitMQ in the mix, raw-SQL migrations (no Prisma), microservice
> private networking via `RAILWAY_PRIVATE_DOMAIN`.

---

## Branch strategy

| Branch    | Auto-deploys to |
|-----------|-----------------|
| `main`    | `production` env |
| `staging` | `staging` env |

Feature work merges into `staging` first; once verified, fast-forward
`main` to release.

**Current state (as of 2026-04-27):** active dev branch is
`feature/sms-otp-registration`. Before first Railway deploy:
1. Merge `feature/sms-otp-registration` → `main`.
2. Create `staging` from `main`.

---

## How requests flow

### Local dev / docker-compose
```
Browser → frontend:3008 (Next.js)
       → /api/* → gateway:3000 → routes to backend services via Docker DNS
```

### Railway
```
Browser ─▶ https://frontend-prod.up.railway.app   (frontend, Next.js)
       └▶ https://gateway-prod.up.railway.app/api/...   (gateway, public)
                  │
                  ├─▶ http://auth.railway.internal:3001
                  ├─▶ http://user-org.railway.internal:3002
                  ├─▶ http://worker.railway.internal:3003
                  ├─▶ http://job-match.railway.internal:3004
                  ├─▶ http://deal.railway.internal:3005
                  ├─▶ http://notification.railway.internal:3006
                  ├─▶ http://admin.railway.internal:3007
                  └─▶ http://payment.railway.internal:3009
```

Backend services are **private** — they have no public domain. They talk
to each other via Railway's free internal `RAILWAY_PRIVATE_DOMAIN`.

The frontend's `NEXT_PUBLIC_API_URL` points at the **gateway's** public
domain, so all browser traffic goes through gateway.

Cardcom callback URLs (J5 redirect after card entry) point at the
gateway's public domain, which proxies `/api/payments/*` to the payment
service.

---

## One-time setup

### 1. Create the Railway project (production environment first)

1. **New Project → Deploy from GitHub repo** → select
   `<your-org>/Shivutz-platform`.
2. Pick the `main` branch.
3. Railway will probably try to auto-detect — cancel; we'll add services
   manually.

### 2. Add the plugins first

Plugins must exist before services boot, because services reference
plugin URLs in their env vars.

In the production environment, click empty canvas → **+ Create**:
- **Database → MySQL** → creates `MySQL` plugin.
- **Database → Redis** → creates `Redis` plugin.
- **Empty Service** → name it `RabbitMQ` → connect a public
  `rabbitmq:3-management-alpine` Docker image (Settings → Source → Docker
  Image → `rabbitmq:3-management-alpine`). Generate a private domain only.

> RabbitMQ alternative: use **CloudAMQP** for production (managed,
> $0 dev tier, $19/mo "little lemur" tier). Skip the RabbitMQ service in
> Railway and set `RABBITMQ_URL` to the AMQPS URL CloudAMQP gives you.

### 3. Add each backend service

For each of the 8 backend services + frontend, do:

**+ Create → GitHub Repo → branch `main` → Service settings:**

| Service | Dockerfile | Port | Public domain? | Watch paths |
|---|---|---|---|---|
| frontend | `services/frontend/Dockerfile` | 3008 | ✅ Generate | `services/frontend/**` |
| gateway | `services/gateway/Dockerfile` | 3000 | ✅ Generate | `services/gateway/**` |
| auth | `services/auth/Dockerfile` | 3001 | ❌ private | `services/auth/**` |
| user-org | `services/user-org/Dockerfile` | 3002 | ❌ private | `services/user-org/**`, `db/migrations/**`, `scripts/**` |
| worker | `services/worker/Dockerfile` | 3003 | ❌ private | `services/worker/**` |
| job-match | `services/job-match/Dockerfile` | 3004 | ❌ private | `services/job-match/**` |
| deal | `services/deal/Dockerfile` | 3005 | ❌ private | `services/deal/**` |
| notification | `services/notification/Dockerfile` | 3006 | ❌ private | `services/notification/**` |
| admin | `services/admin/Dockerfile` | 3007 | ❌ private | `services/admin/**` |
| payment | `services/payment/Dockerfile` | 3009 | ❌ private | `services/payment/**` |

For each: **Settings → Build → Builder = Dockerfile**, set the path
above. **Networking → Generate Domain** only on the two services that
need it. **Healthcheck path:** `/health` for backend services, `/` for
frontend. **Restart policy:** On Failure, 10 retries.

### 4. Wire env vars

Open `docs/RAILWAY_SECRETS_CHECKLIST.md` and set every variable on each
service per that table. Use Railway's `${{Plugin.VAR}}` and
`${{service.RAILWAY_PRIVATE_DOMAIN}}` references — never hardcode hosts.

Critical values:
- `MYSQL_ROOT_PASSWORD = ${{MySQL.MYSQLPASSWORD}}` (yes, the legacy var
  name; code reads `MYSQL_ROOT_PASSWORD`).
- `RABBITMQ_URL = amqp://guest:guest@${{RabbitMQ.RAILWAY_PRIVATE_DOMAIN}}:5672`
  (own container) OR the CloudAMQP AMQPS URL.
- All `*_SERVICE_URL` use the corresponding service's
  `RAILWAY_PRIVATE_DOMAIN` with port 3001/3002/etc.

### 5. Run migrations on first deploy

The migration runner (`scripts/run_migrations.py`) lives at the repo root
and applies every `db/migrations/*.sql` in lexical order, recording
applied files in `auth_db._migrations`. It's idempotent.

**Recommended:** add to user-org's container entrypoint so it runs on
every boot:

```dockerfile
# Add to services/user-org/Dockerfile:
COPY scripts/ /scripts/
COPY db/      /db/

# Replace CMD ["uvicorn", ...] with:
CMD ["sh", "-c", "python /scripts/run_migrations.py --dir /db/migrations && uvicorn app.main:app --host 0.0.0.0 --port 3002"]
```

This way every user-org boot first applies pending migrations, then
serves. New `*.sql` files go live the next time user-org redeploys.

**One-shot alternative:** `railway run python scripts/run_migrations.py`
from your terminal after switching to the production env via
`railway environment`.

### 6. Persistent volume for uploads

On the **user-org** service: **Settings → Volumes → New Volume** →
mount path `/app/uploads`, 5GB to start.

For prod scale, plan to migrate to S3-compatible storage (Cloudflare R2,
Backblaze B2). The upload code in
`services/user-org/app/routes/contractors.py` writes raw files to
`UPLOAD_DIR`; swapping to S3 is a 1-file change.

### 7. Seed the first admin

Set on the **user-org** service:
- `SEED_ADMIN_PHONE = +972...your phone`
- `SEED_ADMIN_NAME = Your Name`

Trigger a redeploy. The entrypoint runs `scripts/seed_admin.py` after
migrations, creating the admin user. **Then delete both env vars from
Railway.** The admin can log in via standard SMS-OTP at
`https://frontend-prod.up.railway.app/login`.

(If `seed_admin.py` isn't already wired into the entrypoint, add a CMD
step similar to the migrations one above. Or run it once manually:
`railway run python scripts/seed_admin.py`.)

### 8. Create the staging environment

1. Railway dashboard → **Environments → New Environment → "staging"**.
2. Choose **"Duplicate from production"**. Railway clones the service
   definitions and creates **fresh, independent plugins** (separate
   MySQL + Redis + RabbitMQ with no shared data).
3. On every service in staging, change the deploy branch from `main` to
   `staging`.
4. **Override** the variables marked ⚠️ in `RAILWAY_SECRETS_CHECKLIST.md`:
   - `JWT_SECRET`, `SERVICE_JWT_SECRET`, `TOKEN_ENCRYPTION_KEY`,
     `CARDCOM_WEBHOOK_SECRET` — generate fresh per env.
   - `SENDGRID_API_KEY`, `VONAGE_*` — staging-specific keys.
   - `PAYMENT_FAKE_MODE = 1`, `MASTER_OTP = 999999` (only in staging).
   - `FRONTEND_URL`, all `*_SERVICE_URL` — Railway updates these
     automatically when you click "Update References" on the duplicated
     services. Verify each one points at the staging domain.
5. Run migrations + seed admin in the staging env (same as steps 5+7).

### 9. Cardcom webhook URL

After gateway has its public domain, set the J5 callback URL in the
Cardcom dashboard to:

- production: `https://gateway-prod.up.railway.app/api/payments/cardcom-webhook`
- staging: `https://gateway-staging.up.railway.app/api/payments/cardcom-webhook`

(Path may differ — confirm against `services/gateway/src/index.js` and
`services/payment/app/routes/transactions.py`.)

---

## Migrations and seed

Both run from `scripts/`. The migration runner is **idempotent** — every
deploy can call it without re-applying old migrations.

**Tracking table:** `auth_db._migrations(filename, sha256, applied_at)`.
The runner skips files whose `filename` already has a row. A SHA mismatch
warning is logged if a previously-applied file's content changed (we
**do not** re-apply).

**Adding a new migration:**
1. Create `db/migrations/019_my_change.sql` (lexical order matters).
2. Push to whichever branch (staging or main).
3. user-org redeploys; the runner picks up the new file and applies it.
4. Verify in Railway logs: `[migrations] applying 019_my_change.sql ...`

**Failed migration:** the runner exits non-zero and Railway marks the
deploy failed without flipping the new revision live. The previous
revision keeps serving traffic. Fix the SQL or roll back, push again.

**Wiping a stuck staging DB:** Railway dashboard → MySQL plugin →
Settings → **Wipe volume**. Service stays, credentials stay, just the
data goes. The next boot re-runs every migration cleanly.

---

## Troubleshooting

### Variable references must be picked from the autocomplete dropdown
- **The biggest single time-sink during the first deploy.** Typing
  `${{MySQL.MYSQLPASSWORD}}` into the value field with the keyboard
  produces a literal text string — Railway sends those exact 28
  characters to your container as the password.
- **Always type `${{` and pick the option from the autocomplete
  dropdown** so it binds as a chip (the value cell renders as a colored
  pill with the source plugin's icon, not as plain text).
- Symptom of a broken binding: container logs show
  `ValueError: invalid literal for int() with base 10: 'MYSQL_PORT'`,
  `Access denied for user 'root'`, or `NOAUTH Authentication required`
  — basically any error where the env var value is being treated as
  the literal reference string.

### Redis plugin's `REDIS_URL` may contain a placeholder password
- We hit this on the first deploy: the Redis plugin's `REDIS_URL`
  variable was literally `redis://default:abc123XYZ987@redis.railway.internal:6379`
  — the documentation example, not the real password. The real password
  was in the `REDIS_PASSWORD` variable on the same plugin.
- **Always inspect the plugin's `REDIS_URL` value before referencing it.**
  If it contains placeholder text like `abc123XYZ987`, fix the plugin's
  variable (replace with the real password from `REDIS_PASSWORD`) before
  any service references it.

### "Cannot connect to MySQL"
- Check that **MYSQL_ROOT_PASSWORD** on the service equals
  `${{MySQL.MYSQLPASSWORD}}` (Railway's auto-generated password).
- Plugin names are case-sensitive. If you renamed the plugin to
  `mysql-prod`, the reference becomes `${{mysql-prod.MYSQLPASSWORD}}`.
- `MYSQL_PORT` can be hardcoded to `3306` (the Railway internal port
  is always 3306) — bypasses the chip-binding issue entirely.

### "RabbitMQ connection refused"
- Own container: confirm the RabbitMQ service has a private domain
  generated. `${{RabbitMQ.RAILWAY_PRIVATE_DOMAIN}}` resolves to the
  internal hostname.
- CloudAMQP: confirm the AMQPS URL includes the vhost (the path
  component) — copy from the CloudAMQP "AMQP URL" field, not the
  individual fields.

### Healthcheck times out
- Backend services: confirm `/health` returns 200 (most do — check
  `services/<svc>/app/main.py` or `index.js`).
- Frontend (Next.js): healthcheck `/`. Next.js 16 standalone needs a
  fresh `npm run build` baked into the image; if you forget, the
  container starts but immediately exits.
- **Set `PORT` env var to match the service's listening port** —
  Railway's healthcheck routes to the port specified by the `PORT` env
  var (defaults to `8080`). Our services listen on hardcoded ports
  (3001-3009), so each service needs `PORT=<its_port>`.
- **First-boot timing:** user-org takes 30-60s to apply 18 migrations
  and seed admin before uvicorn starts. The default 5-minute healthcheck
  window is enough, but if it fails, just redeploy — second boot skips
  all migrations (idempotent) and starts in ~3 seconds.

### "502 Bad Gateway" with `x-railway-fallback: true`
- This 502 comes from Railway's edge proxy, not from your gateway.
  Means the gateway service itself is down or unhealthy.
- Common cause: gateway crashed on Redis connection (rate limiter
  needs Redis) — check gateway Deploy Logs for `[ioredis] NOAUTH`.
- Gateway needs `REDIS_URL` even though it's "just a proxy" — the
  rate limiter on every request requires it.

### Don't bind services to `--host ::` on Railway
- Railway's container runtime doesn't dual-stack reliably. If you set
  `uvicorn --host ::`, the IPv4 healthcheck (source `100.64.0.0/16`)
  will fail and the deploy never goes healthy.
- Stick with `--host 0.0.0.0`. Railway's private networking still
  works fine over IPv4 from one container to another (we briefly
  thought IPv6 was required — it isn't).

### Cross-DB JOIN errors after migration
- Schema names are not configurable per-env — they're hardcoded in SQL.
  All migrations use bare `org_db.contractors` etc. Migrations must run
  in the same DB instance that hosts all 7 schemas.

### Frontend hits the wrong API URL
- `NEXT_PUBLIC_API_URL` is baked at build time. Changing it requires a
  redeploy of the frontend service (Railway does this automatically when
  you change the var).
- **The Dockerfile must declare `ARG NEXT_PUBLIC_API_URL`** before
  `RUN npm run build`. Without the ARG, Railway doesn't pass the
  variable to the build context, AND Docker layer caching skips the
  build step entirely on subsequent deploys (you'll see
  `RUN npm run build cached` in the build log — that's the smoking
  gun). Adding the ARG also makes the value part of the cache key, so
  any URL change forces a real rebuild.
- **The value must end in `/api`** — `client.ts` appends paths like
  `/auth/login` to `NEXT_PUBLIC_API_URL` to form
  `<URL>/api/auth/login`. Set
  `NEXT_PUBLIC_API_URL=https://${{gateway.RAILWAY_PUBLIC_DOMAIN}}/api`.
- Verify in browser devtools → Network — the request `Host` header
  should be the gateway's public domain.

### SMS sender ID rejected (Vonage error code 15)
- Vonage requires alphanumeric sender IDs to be pre-registered for
  most countries, including Israel. Trial accounts can only send to
  test/whitelisted numbers.
- Symptom: Vonage logs show "rejected" with code 15 ("Illegal Sender
  Address").
- Fixes: (a) upgrade Vonage account out of trial, (b) whitelist the
  test number in the dashboard, (c) use a numeric sender via
  `VONAGE_FROM=<numeric>` instead of `Shivutz`, (d) for production,
  pre-register the sender ID with Vonage support, or switch to an
  Israeli SMS provider (InforU, Cellact).

### "phone_not_verified" on Cardcom return
- Cardcom redirects back to the frontend with query params. The
  frontend's payment-return handler then calls
  `/api/payments/{id}/complete-auth` on the gateway. Confirm the
  webhook URL set in Cardcom matches the gateway's actual public domain
  (env subdomain differs between staging/prod).

### Logs show "discrepancy_flag column doesn't exist"
- This is a stale code path from before migration 014. Confirm the deal
  service is on the latest commit; the legacy `transition()` function in
  `deal_lifecycle.py` is now a stub that raises a deprecation error if
  called.

---

## Lessons learned (read these before changing anything)

1. **One MySQL plugin per env, 7 schemas inside.** The cross-DB JOINs
   throughout the codebase (e.g. `org_db.profession_types` from the deal
   service, `auth_db.entity_memberships` from user-org) make split
   plugins infeasible without major refactoring.

2. **Use `RAILWAY_PRIVATE_DOMAIN` for service-to-service.** Public URLs
   route through the internet, may incur egress fees, and add latency.
   Internal traffic is free and ~10× faster.

3. **JWT secrets must differ per environment.** A leaked staging token
   must NOT replay against production. Same for `TOKEN_ENCRYPTION_KEY`
   (encrypts Cardcom tokens) and `CARDCOM_WEBHOOK_SECRET`.

4. **`MASTER_OTP` and `PAYMENT_FAKE_MODE` are staging-only.** Setting
   them in production lets anyone bypass auth and the payment flow.

5. **Run migrations from one place only.** user-org's entrypoint is the
   designated migration host. Don't add the runner to other services'
   entrypoints — concurrent runs would race on the `_migrations` ledger.

6. **Wipe the MySQL volume to retry a failed first migration.** It's
   faster than deleting and re-adding the plugin, and the connection URL
   stays the same so service env vars don't need updating.

7. **Cardcom callbacks need the gateway's public domain.** Cardcom
   doesn't know about Railway's internal network. Always set the
   webhook URL in Cardcom to point at gateway, never directly at
   payment.

8. **Volume on user-org only.** Other services don't write files. If we
   later need shared file storage across services (likely as we scale),
   move to S3-compatible — Railway volumes don't support multi-mount.

9. **The frontend image is env-specific.** `NEXT_PUBLIC_API_URL` bakes at
   build. If we want a single image across envs, switch to runtime
   config via Next.js server-side env reading (not just `NEXT_PUBLIC_*`).

10. **Cron lives in the notification service.** Deal-lifecycle expiry,
    capture, admin-nudge, and contractor revalidation all run from
    `services/notification/src/index.js`. If notification is down, the
    cron stops — admin alerts about "approved deals not capturing" are a
    canary for notification health.
