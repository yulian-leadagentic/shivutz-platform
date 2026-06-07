# Development workflow

The day-to-day loop for this codebase. For environment reference (URLs, env vars, login bypass) see [ENVIRONMENTS.md](./ENVIRONMENTS.md). For the procedural release checklist see [RELEASE.md](./RELEASE.md).

## TL;DR

```
git checkout staging && git pull
docker compose up -d                          # HMR is on by default
# ...edit code, save, see it on localhost:3008 in <1s...
git commit -m "feat(scope): ..."
git push origin staging                        # Railway staging deploys
# ...QA on the staging URL...
# happy → see RELEASE.md to promote to main
```

## The dev loop in detail

### 1. Start the stack

```
docker compose up -d
```

`docker-compose.override.yml` is auto-loaded. The frontend container runs `npm install && npm run dev` against a bind-mount of `services/frontend/`, with `WATCHPACK_POLLING` and `CHOKIDAR_USEPOLLING` enabled so Windows/macOS file events propagate. First boot takes 30–60s (the `npm install` runs into a named volume); subsequent boots reuse the volume and start in seconds.

Backend services do *not* have HMR. They build on `docker compose up`. If you change backend code, rebuild that one service:

```
docker compose up -d --build <service-name>
```

### 2. Edit code

Frontend changes (`services/frontend/src/...`) appear at `http://localhost:3008/` immediately via HMR.

Backend changes need a rebuild of the affected service (see above).

For Hebrew UI: the HTML root is `<html lang="he" dir="rtl">`. Use logical Tailwind utilities (`ms-`, `me-`, `start-`, `end-`) so layouts mirror correctly — `ml-*` and `mr-*` will appear backwards.

### 3. Sanity-check the change

For UI changes: open `localhost:3008/` and click through the affected flow. Type-checks and unit tests don't catch broken layouts.

For backend changes: `docker compose logs -f <service>` to watch the service boot and see request logs. Hit the gateway (`localhost:3000/api/...`) directly with `curl` if you need to isolate from the frontend.

For migration changes: see [ENVIRONMENTS.md § Migrations on local](./ENVIRONMENTS.md#migrations-on-local). Local Docker mounts migrations into MySQL's init dir — *only runs on first boot*. Wipe with `docker compose down -v` to re-run.

### 4. Commit

Follow the existing commit style. Look at `git log --oneline -20` for examples — most are `feat(scope): ...` or `fix(scope): ...` with a short body explaining *why*.

Commit-message style notes:
- Subject line under 72 chars
- Body wraps at ~72 chars and explains motivation, constraints, or non-obvious tradeoffs
- Reference issues / PRs in the body, not the subject

### 5. Push to staging

```
git push origin staging
```

Railway auto-deploys. ~2 minutes from push to a live container.

Watch the deploy in Railway's dashboard. If it fails to build, check [RAILWAY_DEPLOYMENT.md](./RAILWAY_DEPLOYMENT.md) for known gotchas — usually missing env vars, build-args not declared in Dockerfile `ARG`, or non-idempotent migrations.

### 6. QA on staging

Open `https://frontend-staging-3206.up.railway.app/`. Login with phone `+972525278625` + OTP `999999` (master-OTP bypass is enabled on staging).

Verify the change end-to-end against real Railway infrastructure. Staging mirrors prod — pass on staging means you've earned the right to promote.

### 7. Promote to production

See [RELEASE.md](./RELEASE.md) for the full checklist. Short version:

```
git checkout main
git merge staging
git push origin main           # Railway prod deploys
git checkout staging
```

## When Claude is doing the work

Claude Code can run in a "worktree" — a physically separate copy of the repo at `.claude/.claude/worktrees/<name>/` on a feature branch named `claude/<name>`. This is great for isolation but adds a wrinkle: **edits made in the worktree don't reach `localhost:3008` until they're merged into your active branch.**

The merge dance:

```
# Claude commits in the worktree
# Then in your main checkout:
git checkout staging
git merge --no-ff claude/<name>
# Resolve conflicts (likely, since staging moves fast)
git commit      # completes the merge
docker compose up -d --build frontend   # only needed if Dockerfile/deps changed; HMR handles code
```

If Claude is working on `staging` directly (not in a worktree), HMR picks up the changes live and there's no merge step.

### Conflict resolution tips

When `staging` has moved on since the worktree branched off:
- Read what's on `staging` — `git log --oneline main..staging` shows commits the worktree might not know about
- Resolve in favor of preserving recent `staging` work, then re-apply the worktree's intent on top
- The worktree base may be stale enough that *the feature it was solving has been redesigned*. That happened on 2026-05-08 with the dashboard hero — the worktree branched from `main`, but `staging` had already shipped a Wave-4 redesign. The fix layered the hero onto the new design rather than reverting it.

## When something is wrong

| Symptom | First place to look |
|---|---|
| HMR not working | `docker compose logs -f frontend`. If you see `npm install` running every save, the volume might be missing — recreate with `docker compose down && docker compose up -d`. |
| Page bounces to `/login` | Not a frontend bug. The API client (`services/frontend/src/lib/api/client.ts`) redirects on any 401. Check what the gateway/auth services returned. |
| `package.json` deps not picked up | Override mounts a named volume at `/app/node_modules`. Run `docker volume rm shivutz-platform_frontend_node_modules` then `docker compose up -d` to reinstall. |
| Local Docker fine but staging broken | Likely an env-var that's set in your `.env` but not on Railway. Cross-reference [RAILWAY_SECRETS_CHECKLIST.md](./RAILWAY_SECRETS_CHECKLIST.md). |
| Migration didn't apply locally | Local MySQL only runs migrations on first boot. `docker compose down -v && docker compose up -d`. (Staging/prod are different — they re-apply on every deploy.) |

## Things to avoid

- **Don't push to `main` directly.** Always go through `staging` first. The one exception is hotfixes — see [ENVIRONMENTS.md § Hotfix exception](./ENVIRONMENTS.md#workflow-staging-first-then-main).
- **Don't add `MASTER_OTP=999999` to production config.** It's a deliberate dev/staging convenience; production must use real SMS.
- **Don't commit `.env`.** It's gitignored. Secrets live there only.
- **Don't add backwards-compatibility shims for renames.** This is a pre-launch codebase — no live data, no live API consumers. Rename freely.
