# Shivutz Platform

A digital marketplace for placing licensed foreign workers from Israeli manpower corporations onto construction-contractor projects. Hebrew-first UI, RTL throughout, Israel-specific identity and registry checks.

End-to-end flow: contractor publishes a job → AI-assisted matching against corporation worker rosters → contractor proposes a deal → corporation accepts or counters → workers get assigned → reporting and payment close out.

## Repository layout

```
services/                — 9 backends + the Next.js frontend, each independently deployable
  frontend/              — Next.js 16 (App Router), Tailwind, shadcn/ui-derived components
  gateway/               — public API surface; routes to internal services
  auth/                  — phone + email OTP, JWT issue/refresh
  user-org/              — users, organizations (contractor, corporation), memberships
  worker/                — corporation worker rosters, professions, regions, origins
  job-match/             — contractor job-requests + matching engine
  deal/                  — proposed/active/completed deals between contractors and corporations
  notification/          — SMS (Vonage), email (SendGrid placeholder), webhooks
  admin/                 — admin-only views over user-org, job-match, deal
  payment/               — Cardcom J5 holds, billing, marketplace subscriptions
db/migrations/           — versioned SQL applied across all services' DBs
docs/                    — operational and engineering reference (read these first)
scripts/                 — Python utilities for seeding, smoke-tests, registry probes
docker-compose.yml       — production-style local stack (used to mirror Railway)
docker-compose.override.yml — auto-loaded; replaces frontend with HMR `next dev`
railway.json             — deployment entrypoint for Railway envs (staging + production)
```

## Run it locally

Requires Docker Desktop ≥ 4.30 (Compose v2.24+ for the `!reset` directive in the override file).

```
cp .env.example .env       # then edit secrets — see docs/ENVIRONMENTS.md for required vars
docker compose up -d
```

After about a minute the stack is up:

| Service       | URL / port            |
|---------------|-----------------------|
| Frontend      | http://localhost:3008 |
| Gateway (API) | http://localhost:3000 |
| RabbitMQ UI   | http://localhost:15672 |

Login on the frontend: phone `+972525278625`, OTP `999999` (master-OTP bypass — only works because `MASTER_OTP=999999` is in your local `.env`).

The frontend is in HMR mode by default — save any file in `services/frontend/src/` and changes appear in <1s on `localhost:3008`. Backend services rebuild on `docker compose up`; for fast backend iteration, mirror the override pattern per service.

## Where to read next

| Doc | When to open it |
|---|---|
| [docs/ENVIRONMENTS.md](docs/ENVIRONMENTS.md) | Source of truth for local / staging / production. Branch flow, env-var matrix, login bypass status, "wipe staging" recipe. |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Day-to-day dev loop: edit → HMR → commit → push → Railway. Includes the worktree-merge dance for AI-driven changes. |
| [docs/RELEASE.md](docs/RELEASE.md) | Procedural checklist for promoting `staging → main`. Run through this every release. |
| [docs/RAILWAY_DEPLOYMENT.md](docs/RAILWAY_DEPLOYMENT.md) | Setup history + service-by-service Railway gotchas. Read when something refuses to deploy. |
| [docs/RAILWAY_SECRETS_CHECKLIST.md](docs/RAILWAY_SECRETS_CHECKLIST.md) | Required env vars per service, per environment. |
| [CLAUDE.md](CLAUDE.md) | Auto-loaded by Claude Code. Project-shape facts an AI session needs in its first 30 seconds. |

## Branch model

`staging` is the active dev branch. `main` is production-only.

```
local Docker (any branch)  →  push staging  →  Railway staging deploys  →  merge to main  →  Railway prod deploys
```

Never push directly to `main` except for hotfixes. See [docs/ENVIRONMENTS.md#workflow-staging-first-then-main](docs/ENVIRONMENTS.md#workflow-staging-first-then-main).
