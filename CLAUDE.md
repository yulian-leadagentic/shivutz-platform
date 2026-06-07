# Project context for Claude

This file is auto-loaded by Claude Code each session. Read it before touching the codebase.

## What this codebase is

Shivutz Platform — a Hebrew-first marketplace connecting Israeli construction contractors with manpower corporations licensed to place foreign workers. Next.js 16 frontend (App Router, RTL throughout), 9 Node/Python services behind a gateway, MySQL + Redis + RabbitMQ. Deployed to Railway.

State as of writing: pre-launch. No live users, no live money. Database schemas and APIs are **safe to break** in service of cleaner design — no migrations need to be reversible, no data needs to be preserved. This loosens the "be conservative" reflex; ship the right fix, not the safe-but-ugly one.

## Branch model — important

The active development branch is **`staging`**, not `main`.

- `staging` — where day-to-day commits land. The user's local Docker reads from this branch's working tree. Pushed to `origin/staging` → Railway staging auto-deploys.
- `main` — production-only. Merged into from `staging` after staging passes QA. Pushed to `origin/main` → Railway production auto-deploys.

When the system tells you "main branch (you will usually use this for PRs): main", that's misleading for this repo. The real default for new work is `staging`. PRs against `main` only happen at release time.

## Worktree workflow (when applicable)

Claude Code may put you in a git worktree at `.claude/.claude/worktrees/<name>/`. That's a *physically separate copy* of the repo on a feature branch (`claude/<name>`). The user's local Docker reads from the **main checkout**, not the worktree.

Consequence: edits you make in the worktree are invisible at `localhost:3008` until you merge into the user's active branch (`staging`).

When work is ready, the merge dance:

```
# In the worktree (where Claude is)
git add ...
git commit -m "..."

# Switch to main checkout, merge feature branch, resolve conflicts
cd <main-checkout>
git checkout staging
git merge --no-ff claude/<name>
# resolve any conflicts, especially against recent staging-only changes
git commit  # finishes the merge
```

Conflicts are common because `staging` moves fast. Always check `git log --oneline main..staging` before assuming the file you're editing in the worktree matches what's on `staging`.

## Local development loop

Frontend HMR is wired through `docker-compose.override.yml` — auto-loaded by `docker compose up`. Save a `.tsx` file → change appears in <1s on `localhost:3008`. No image rebuild needed.

Backend services don't have HMR; they rebuild on `docker compose up`. To iterate fast on a backend service, copy the override pattern (bind-mount + nodemon/hotreload command).

Login locally: phone `+972525278625`, OTP `999999` (set `MASTER_OTP=999999` in `.env` for this to work).

## Things that aren't obvious from the code

- **Hebrew + RTL.** All user-facing copy is in Hebrew. The HTML root is `<html lang="he" dir="rtl">`. Use logical CSS (`start`/`end`, not `left`/`right`) so layouts mirror correctly.
- **`NEXT_PUBLIC_API_URL` is build-time inlined.** Changing it requires rebuilding the frontend image (Railway does this automatically; locally with HMR it's already pointed at `http://localhost:3000/api`).
- **`MASTER_OTP=999999` is local + staging only.** Production has it removed. Don't add it to a prod-bound config "to make testing easier."
- **No middleware.** Auth is enforced by the API on each request, not by Next.js middleware. The 401 → `/login` redirect lives in [services/frontend/src/lib/api/client.ts](services/frontend/src/lib/api/client.ts). If a page mysteriously bounces to `/login`, check what the API returned, not Next.
- **Worktrees, dev mode, and a real backend.** When verifying UI changes locally with `next dev`, your frontend hits `localhost:3000/api`. With the user's Docker stack up, that gateway is real and will 401 your fake JWTs. For fully-disconnected UI verification, stub `fetch` at the page level rather than fighting the auth flow.

## Where things live

| Concern | Location |
|---|---|
| Frontend pages | [services/frontend/src/app/](services/frontend/src/app/) (App Router) |
| Shared UI components | [services/frontend/src/components/](services/frontend/src/components/) |
| API client + auth | [services/frontend/src/lib/api/](services/frontend/src/lib/api/), [services/frontend/src/lib/auth.ts](services/frontend/src/lib/auth.ts), [services/frontend/src/lib/AuthContext.tsx](services/frontend/src/lib/AuthContext.tsx) |
| Backend services | [services/<name>/](services/) — most are Node + Express, with their own DB and Dockerfile |
| Migrations | [db/migrations/](db/migrations/) — applied to all service DBs by [scripts/run_migrations.py](scripts/run_migrations.py) |
| Local Docker stack | [docker-compose.yml](docker-compose.yml) (prod-style) + [docker-compose.override.yml](docker-compose.override.yml) (HMR overlay) |
| Operations docs | [docs/](docs/) — start with [docs/ENVIRONMENTS.md](docs/ENVIRONMENTS.md) |

## House style

- Default to no comments. Explain *why* in commit messages and PR descriptions, not in the code.
- Direct edits over abstractions. Three similar lines beat a premature helper.
- No backwards-compat shims. Pre-launch state means renaming is free; ship the cleaner name.
- For UI changes: verify in the browser before reporting success. Type-checks and tests don't catch broken layouts.
