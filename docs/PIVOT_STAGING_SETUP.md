# pivot-staging setup — step by step

Current state (assumed done):
- Railway environment `pivot-staging` exists
- All app services have been re-pointed to branch `pivot/v2`
- Database services (MySQL, Redis, RabbitMQ) are **still shared** with `staging` — must fix before any migration is run

Goal of this doc: separate the pivot databases, update env-var references, run migrations against the new MySQL, optionally attach a custom domain. ~30–60 minutes total.

---

## 1. Create new database services in `pivot-staging`

In Railway, top-bar dropdown → switch to `pivot-staging`.

For each of MySQL, Redis, RabbitMQ:

1. Click **+ New** (top-right of the canvas).
2. Choose **Database**.
3. Pick the engine (MySQL / Redis / RabbitMQ).
4. Wait ~30s for provisioning.
5. Rename it so it's obvious it's the pivot copy:
   - `mysql` → `mysql-pivot`
   - `redis` → `redis-pivot`
   - `rabbitmq` → `rabbitmq-pivot`
   - (Service → Settings → Service Name)

You should now see 3 brand-new DB tiles in the pivot-staging canvas.

---

## 2. Re-point every app service to the new databases

This is the step where it's easy to miss a service. Hit every one.

App services to touch (in `pivot-staging`):
- `gateway`
- `auth`
- `user-org`
- `worker`
- `deal`
- `job-match`
- `notification`
- `payment`
- `admin`
- `frontend` (usually doesn't need DB env vars, but check)

For each service:

1. Click the service → **Variables** tab.
2. Find any variable whose value references the OLD database, e.g. `${{mysql.MYSQL_URL}}` or `${{Redis.REDIS_URL}}`.
3. Change it to point at the new pivot DB. Railway autocompletes — start typing `${{mysql-pivot.` and pick `MYSQL_URL` from the dropdown.
4. Common variable names to check (not all services have all of these):
   - `MYSQL_URL`, `DATABASE_URL`, `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`
   - `REDIS_URL`, `REDIS_HOST`, `REDIS_PORT`
   - `RABBITMQ_URL`, `AMQP_URL`
5. Save. Railway will redeploy the service automatically.

**Cross-check:** open each app service's **Deployments → latest deploy → Variables** and confirm the resolved values point at the pivot DB hosts (`mysql-pivot.railway.internal` etc.), not the staging ones.

---

## 3. Run migrations against `mysql-pivot`

Migrations live in [db/migrations/](../db/migrations/) and are applied by [scripts/run_migrations.py](../scripts/run_migrations.py).

The fresh `mysql-pivot` instance has no databases yet — migrations create them.

### Option A — run from your local machine (recommended for the first run)

1. Get the public connection string for `mysql-pivot`:
   - Railway → `mysql-pivot` service → **Connect** tab → copy the `mysql://` public URL.
2. Set it in a temporary shell var and run:

```bash
# From the repo root on your machine
export DATABASE_URL='mysql://root:PASSWORD@HOST:PORT/'
python scripts/run_migrations.py
```

You should see lines like `Applied 001_init.sql → auth_db` for each migration × each schema. If anything errors out, fix it before continuing.

### Option B — one-off command from Railway

Service → Settings → **Deploy** → "One-off command" → `python scripts/run_migrations.py`. Less convenient because you have to dig logs to see what happened.

---

## 4. Update FRONTEND_URL and NEXT_PUBLIC_API_URL

These were set on the staging copy and still point at the staging domain. Until you attach a custom domain (step 5), use the Railway-generated `*.up.railway.app` URLs.

1. Get the frontend's public URL:
   - `pivot-staging` → `frontend` service → Settings → **Networking** → "Generate Domain" if not already → copy the `*.up.railway.app` URL.
2. Get the gateway's public URL the same way.
3. Update these variables (each on the listed service):

| Service | Variable | New value |
|---|---|---|
| `notification` | `FRONTEND_URL` | `https://<frontend>.up.railway.app` |
| `admin` | `FRONTEND_URL` | `https://<frontend>.up.railway.app` |
| `user-org` | `FRONTEND_URL` | `https://<frontend>.up.railway.app` |
| `frontend` | `NEXT_PUBLIC_API_URL` | `https://<gateway>.up.railway.app/api` |

**Important:** `NEXT_PUBLIC_API_URL` is **build-time inlined** by Next.js — after changing it you must trigger a fresh frontend deploy (Railway → frontend → Deployments → "Redeploy"). Just saving the var is not enough.

---

## 5. (Optional) Attach a custom domain — `pivot.tagidai.com`

Only if you want a clean URL instead of `*.up.railway.app`. Can be skipped or done later.

1. **At Railway:** frontend service → Settings → **Networking** → "Custom Domain" → enter `pivot.tagidai.com`. Railway shows you a CNAME target like `xyz.up.railway.app`.
2. **At your DNS provider** (Cloudflare / Namecheap / wherever `tagidai.com` is):
   - Add a CNAME record:
     - Name: `pivot`
     - Target: the CNAME Railway gave you
     - TTL: default
   - If Cloudflare: set the proxy status to **DNS only** (gray cloud) initially — orange-cloud sometimes breaks Railway's TLS handshake. Switch to orange after it works.
3. Wait 5–10 minutes. Refresh Railway's networking page until it says "Active".
4. Update the env vars from step 4 to use `https://pivot.tagidai.com` instead of `*.up.railway.app`.
5. **Redeploy** `frontend` so the new `NEXT_PUBLIC_API_URL` is inlined.

---

## 6. Sanity check — is it working?

1. Open the frontend public URL.
2. Try to log in with phone `+972525278625` + OTP `999999`. (Requires `MASTER_OTP=999999` set on the `auth` service in `pivot-staging`. Same as staging.)
3. After login you should land on `/contractor/...` or `/select-entity` — same flow as staging today. If you get bounced to `/login` immediately, check:
   - JWT_SECRET on `auth` and `gateway` match
   - `NEXT_PUBLIC_API_URL` was rebuilt into the frontend (not just set as env var)

---

## Common gotchas (we hit these on staging earlier)

- **`FRONTEND_URL` on the wrong service** — it's *consumed* by `notification`, `admin`, and `user-org`. Setting it on `frontend` itself has no effect.
- **Railway template literals** — write `${{frontend.RAILWAY_PUBLIC_DOMAIN}}` exactly, no stray backticks or trailing `*`. Or just paste the literal URL.
- **`NEXT_PUBLIC_*` vars need a rebuild** — they're inlined at build time. Saving + restarting is not enough.
- **Shared DB if you skip step 1** — every migration you run will hit your live staging DB. Always confirm the resolved variables point at `mysql-pivot.railway.internal` before running migrations.

---

## After this is done

Tell me, and I'll start writing Phase 1:
- Migration 060 (subscriptions table)
- Payment-service subscription endpoints with fake-Cardcom mode
- Gateway `requireSubscription` middleware
- Minimal `/billing` page

All on `pivot/v2`. Each push will auto-deploy to `pivot-staging` once the env is set up correctly.
