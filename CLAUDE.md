# Project context for Claude

This file is auto-loaded by Claude Code each session. Read it before touching the codebase.

## What this codebase is

Shivutz Platform — a Hebrew-first marketplace connecting Israeli construction contractors with manpower corporations licensed to place foreign workers. Next.js 16 frontend (App Router, RTL throughout), 9 Node/Python services behind a gateway, MySQL + Redis + RabbitMQ. Deployed to Railway.

State as of writing: pre-launch. No live users, no live money. Database schemas and APIs are **safe to break** in service of cleaner design — no migrations need to be reversible, no data needs to be preserved. This loosens the "be conservative" reflex; ship the right fix, not the safe-but-ugly one.

## Branch model — important

> **⚠️ CHECK THIS FIRST — verified 2026-08-13.** The description below says `staging`, but the
> working checkout's HEAD is **`pivot/v2`**, and all 25 most recent commits are on `pivot/v2`.
> `git log main..staging` returns only older commits. **Run `git rev-parse --abbrev-ref HEAD`
> and commit to the branch you are actually on** — do not assume `staging` from this file.
> Resolving this properly is item **B1** in `docs/cc-prompts/cc_master_backlog.md`, and it needs
> a decision from Yulian: is `staging` still in the chain, or does `pivot/v2` go straight to `main`?

The active development branch is **`staging`**, not `main`. *(Stale — see the warning above.)*

- `staging` — where day-to-day commits land. The user's local Docker reads from this branch's working tree. Pushed to `origin/staging` → Railway staging auto-deploys.
- `main` — production-only. Merged into from `staging` after staging passes QA. Pushed to `origin/main` → Railway production auto-deploys.

When the system tells you "main branch (you will usually use this for PRs): main", that's misleading for this repo. The real default for new work is `staging`. PRs against `main` only happen at release time.

## Line endings — known issue

`git status` currently reports ~68 migrations and most of the repo as modified. This is CRLF
conversion, not real work (`git diff --numstat db/migrations/001_initial_schema.sql` → `471 471`,
i.e. every line "changed"). `core.autocrlf` is unset and there is no `.gitattributes`.

Until item **B2** in `docs/cc-prompts/cc_master_backlog.md` lands, `git status` is not a reliable
signal of what you changed. Use `git diff -w --stat -- <specific-file>` to review your own work,
and stage files explicitly — never `git add -A`.

## Start here

`docs/cc-prompts/cc_master_backlog.md` is the run file: ordered backlog, launch blockers,
repo-hygiene items, and the tracks. Read it before picking up work.

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

## Migrations before code

`origin/staging` auto-deploys. A push of code that reads a new column or
table BEFORE that migration has run on the staging DB takes staging down
until it does.

Order, always:
  1. run the migration on staging
  2. verify the schema
  3. push the code

This is not a style preference — it is the deploy order. L4 and L5 shipped
code before migrations `071` / `072` had run on staging; the pattern is
captured here so it doesn't repeat.

The user-org container runs `scripts/run_migrations.py` on entrypoint, so
in practice the fix is to make sure the migration file lands in the same
push as (or before) the code, and to verify via `railway ssh --service
user-org` after Railway rebuilds.

## House style

- Default to no comments. Explain *why* in commit messages and PR descriptions, not in the code.
- Direct edits over abstractions. Three similar lines beat a premature helper.
- No backwards-compat shims. Pre-launch state means renaming is free; ship the cleaner name.
- For UI changes: verify in the browser before reporting success. Type-checks and tests don't catch broken layouts.
