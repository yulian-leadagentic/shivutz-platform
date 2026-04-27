# Railway Secrets Checklist

Per-environment env-var inventory for Shivutz on Railway. Two
environments: **production** and **staging**. **Never share secrets
between environments** — a leaked staging token must NOT replay against
prod.

Legend
- 🔁 **Same per env** — copy from local `.env` or use Railway plugin reference
- 🎲 **Generate fresh** — `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`
- ⚠️ **Different per env, mandatory** — leak risk if shared
- 🌐 **Cross-service reference** — `${{service.RAILWAY_PUBLIC_DOMAIN}}` or `${{plugin.MYSQL_URL}}`

Set on the listed services. "All" means every service in the env.

---

## Infrastructure plugins (auto-provided)

These come from Railway's MySQL/Redis plugins. **Reference them via
`${{Plugin.VAR}}`; do not hardcode.**

| Variable | Source | Used by |
|---|---|---|
| `${{MySQL.MYSQLHOST}}` | Railway MySQL plugin | All Python + Node services that hit MySQL |
| `${{MySQL.MYSQLPORT}}` | Railway MySQL plugin | Same |
| `${{MySQL.MYSQLUSER}}` | Railway MySQL plugin (`root`) | Same |
| `${{MySQL.MYSQLPASSWORD}}` | Railway MySQL plugin (auto-generated) | Same |
| `${{Redis.REDIS_URL}}` | Railway Redis plugin | auth (rate limit), notification |
| `${{RabbitMQ.RABBITMQ_URL}}` | Either own RabbitMQ container or CloudAMQP | user-org, deal, notification |

Map these to the names our code expects:

| Code expects | Set to | Notes |
|---|---|---|
| `MYSQL_HOST` | `${{MySQL.MYSQLHOST}}` | |
| `MYSQL_PORT` | `${{MySQL.MYSQLPORT}}` | |
| `MYSQL_USER` | `${{MySQL.MYSQLUSER}}` | Defaults to `root`; Railway provides this |
| `MYSQL_ROOT_PASSWORD` | `${{MySQL.MYSQLPASSWORD}}` | Naming legacy — code reads `MYSQL_ROOT_PASSWORD` |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` | |
| `RABBITMQ_URL` | own container: `amqp://guest:guest@${{RabbitMQ.RAILWAY_PRIVATE_DOMAIN}}:5672` <br> CloudAMQP: full AMQPS URL from CloudAMQP dashboard | |

---

## Database schema names (🔁 same per env)

These are logical schema names inside the single MySQL plugin. Same in
both envs because the migration files reference them by name.

| Variable | Value | Set on |
|---|---|---|
| `AUTH_DB_NAME`     | `auth_db`     | auth |
| `ORG_DB_NAME`      | `org_db`      | user-org, admin |
| `WORKER_DB_NAME`   | `worker_db`   | worker, admin |
| `JOB_DB_NAME`      | `job_db`      | job-match, admin |
| `DEAL_DB_NAME`     | `deal_db`     | deal, admin |
| `NOTIF_DB_NAME`    | `notif_db`    | notification, admin |
| `PAYMENT_DB_NAME`  | `payment_db`  | payment, admin |

For services like `admin` that talk to multiple schemas, all DB_NAME vars
need to be set so `init_db` can verify connectivity to each.

---

## JWT (⚠️ different per env, mandatory)

Generate four fresh secrets per environment with:
```
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

| Variable | Set on | Notes |
|---|---|---|
| `JWT_SECRET`           | auth, gateway, admin, user-org | 48-byte base64 |
| `SERVICE_JWT_SECRET`   | All services | Internal cross-service auth (currently unused but reserved) |
| `JWT_ACCESS_EXPIRES_IN` | auth | `15m` (same per env) |
| `JWT_REFRESH_EXPIRES_IN` | auth | `7d` (same per env) |
| `TOKEN_ENCRYPTION_KEY` | payment | `openssl rand -base64 32` — encrypts Cardcom tokens at rest |

---

## Inter-service URLs (🌐 cross-reference)

Use Railway's **private** domain for service-to-service traffic — free,
low-latency, never leaves Railway's network.

| Variable | Set on | Value |
|---|---|---|
| `AUTH_SERVICE_URL`         | gateway, user-org, admin | `http://${{auth.RAILWAY_PRIVATE_DOMAIN}}:3001` |
| `USER_ORG_SERVICE_URL`     | gateway, admin, notification | `http://${{user-org.RAILWAY_PRIVATE_DOMAIN}}:3002` |
| `WORKER_SERVICE_URL`       | gateway, deal, notification | `http://${{worker.RAILWAY_PRIVATE_DOMAIN}}:3003` |
| `JOB_MATCH_SERVICE_URL`    | gateway, deal | `http://${{job-match.RAILWAY_PRIVATE_DOMAIN}}:3004` |
| `DEAL_SERVICE_URL`         | gateway, notification | `http://${{deal.RAILWAY_PRIVATE_DOMAIN}}:3005` |
| `NOTIFICATION_SERVICE_URL` | gateway, user-org, admin | `http://${{notification.RAILWAY_PRIVATE_DOMAIN}}:3006` |
| `ADMIN_SERVICE_URL`        | gateway | `http://${{admin.RAILWAY_PRIVATE_DOMAIN}}:3007` |
| `PAYMENT_SERVICE_URL`      | gateway, deal | `http://${{payment.RAILWAY_PRIVATE_DOMAIN}}:3009` |
| `FRONTEND_URL`             | All services that send notifications (notification, user-org, admin) | Public domain of frontend, e.g. `https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}` |

---

## Gateway public domain

Generate a public domain on the **gateway** service. Pass it everywhere
that needs to compose user-facing URLs.

| Variable | Set on | Value |
|---|---|---|
| `GATEWAY_PORT` | gateway | `3000` (Railway sets `$PORT` automatically; gateway reads it) |
| `RATE_LIMIT_ANON`  | gateway | `30` |
| `RATE_LIMIT_USER`  | gateway | `200` |
| `RATE_LIMIT_ADMIN` | gateway | `500` |

---

## Notifications — SendGrid + SMS (⚠️ different per env)

For staging, use a separate SendGrid sub-account or an explicit "staging"
sender to keep prod email reputation isolated. For SMS, use a stub
provider in staging if possible.

| Variable | Set on | Notes |
|---|---|---|
| `SENDGRID_API_KEY` | notification | ⚠️ **Different per env** — staging uses a dev/sandbox key |
| `SENDGRID_FROM_EMAIL` | notification | `noreply@shivutz-platform.co.il` (or staging variant) |
| `SENDGRID_FROM_NAME` | notification | `Shivutz Platform` (or `Shivutz Staging`) |
| `ADMIN_EMAIL` | notification | Where admin alerts route (e.g. yulian@leadagentic.net for staging, ops list for prod) |
| `SMS_PROVIDER` | auth, notification | `stub` for staging, `vonage`/`inforu`/`twilio` for prod |
| `VONAGE_API_KEY` | auth, notification | ⚠️ Per env if using vonage |
| `VONAGE_API_SECRET` | auth, notification | ⚠️ Per env |
| `VONAGE_FROM` | auth, notification | `Shivutz` (or `Shivutz-Stg`) |
| `VONAGE_SIGNATURE_SECRET` | notification | ⚠️ Per env (webhook verification) |
| `MASTER_OTP` | auth | **Set in staging only** (e.g. `999999` for QA). **NEVER set in production.** |

---

## Cardcom (⚠️ different per env)

Use Cardcom's TEST terminal in staging, real terminal in production.

| Variable | Set on | Notes |
|---|---|---|
| `CARDCOM_TERMINAL_NUMBER` | payment | `1000` (test) for staging, real terminal # for prod |
| `CARDCOM_API_NAME` | payment | Test creds in staging, real in prod |
| `CARDCOM_API_PASSWORD` | payment | ⚠️ Per env |
| `CARDCOM_BASE_URL` | payment | `https://secure.cardcom.solutions` (same in both — Cardcom doesn't have a separate test endpoint) |
| `CARDCOM_WEBHOOK_SECRET` | payment | 🎲 Generate fresh per env |
| `PAYMENT_FAKE_MODE` | payment | `1` in staging while testing, `0` in production |

---

## Match cache

| Variable | Set on | Value |
|---|---|---|
| `MATCH_CACHE_TTL_SECONDS` | job-match | `300` (same in both envs) |

---

## File uploads — persistent volume

Attach a Railway volume to the **user-org** service:
- Mount path: `/app/uploads`
- Size: 5GB to start (resize as needed)

The `UPLOAD_DIR` env var is already defaulted to `/app/uploads` in the
code, no override needed.

---

## First-deploy admin seed (delete after first boot)

Set these once on user-org's first deploy of each environment, then
**delete them** from Railway's variables tab.

| Variable | Set on | Value |
|---|---|---|
| `SEED_ADMIN_PHONE` | user-org | e.g. `+972501234567` |
| `SEED_ADMIN_NAME`  | user-org | e.g. `Yulian Abramovich` |

The user-org entrypoint runs `python scripts/seed_admin.py` after
migrations. If both vars are set and no admin exists, the admin is
created and the script logs a reminder to delete the vars.

---

## Frontend (Next.js)

Built with `NEXT_PUBLIC_*` vars baked at build time. Each environment has
its own image. Set on the **frontend** service:

| Variable | Set on | Value |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | frontend | `https://${{gateway.RAILWAY_PUBLIC_DOMAIN}}` |

If we later switch to runtime config (so one image works in both envs),
this checklist updates accordingly.

---

## Per-env summary tables

### Production env

| Plugin | What it provides |
|---|---|
| MySQL | The single shared database, 7 schemas |
| Redis | Rate limiter + cache |
| RabbitMQ container OR CloudAMQP | Message bus for events |

| Service | Public domain? | Volume? |
|---|---|---|
| frontend | ✅ public | — |
| gateway | ✅ public (this is the API entrypoint) | — |
| auth | ❌ private only | — |
| user-org | ❌ private only | ✅ `/app/uploads` |
| worker | ❌ private only | — |
| job-match | ❌ private only | — |
| deal | ❌ private only | — |
| notification | ❌ private only | — |
| admin | ❌ private only | — |
| payment | ❌ private only | — |

Cardcom callbacks come back through gateway's public domain, which
proxies `/api/payments/*` to the payment service.

### Staging env

Identical shape. Differences:
- All ⚠️ secrets regenerated independently
- `PAYMENT_FAKE_MODE=1`, `MASTER_OTP=999999` allowed
- Cardcom test terminal + sandbox SendGrid
- Volume can be smaller
- Plugins can be on smaller compute tiers
