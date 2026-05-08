# Release checklist — promoting `staging` → `main`

A procedural walkthrough. Run through it for every release. For *why* the flow looks this way (the architecture and reasoning) see [ENVIRONMENTS.md](./ENVIRONMENTS.md).

## Before you start

- [ ] All target changes are committed and pushed to `origin/staging`
- [ ] No in-flight PRs against `staging` that should be in this release
- [ ] You're on a clean working tree (`git status` is empty)

## Step 1 — Verify staging is healthy

- [ ] Open `https://frontend-staging-3206.up.railway.app/`
- [ ] Login: phone `+972525278625`, OTP `999999`
- [ ] Click through every flow that this release touches:
  - [ ] Affected pages render without console errors
  - [ ] Forms submit, no 500s
  - [ ] Hebrew/RTL renders correctly (no flipped layouts)
- [ ] Check Railway dashboard — every service shows latest commit, no failed deploys
- [ ] If a migration ran, verify it succeeded in the staging MySQL plugin (Railway → MySQL → Logs)

If anything fails: don't release. Fix on `staging` first, push, re-verify.

## Step 2 — Update local `staging` and `main`

```
git checkout staging
git pull origin staging

git checkout main
git pull origin main
```

If `git pull` on `main` shows new commits, someone else released since you last looked — verify their changes don't conflict with yours.

## Step 3 — Merge

```
git checkout main
git merge --no-ff staging -m "Release: <date or version>"
```

`--no-ff` keeps the merge commit visible in `main`'s history, so it's clear when each release shipped.

If conflicts: this should be rare since `main` only receives from `staging`. If they happen, resolve in favor of `staging` — that's where the validated work lives. Then `git commit` to finish the merge.

## Step 4 — Push to production

```
git push origin main
```

Railway picks up the push within seconds and starts deploying every service with changes. Watch the dashboard — typical deploy takes ~2 minutes per service.

If a service fails to build:
- [ ] Check the build logs in Railway for the failing service
- [ ] Common causes: missing env var, Dockerfile `ARG` not declared, non-idempotent migration. See [RAILWAY_DEPLOYMENT.md](./RAILWAY_DEPLOYMENT.md).
- [ ] If it's not fixable in 5 minutes: revert. See [Rollback](#rollback) below.

## Step 5 — Smoke test production

- [ ] Open `https://frontend-production-d7cd.up.railway.app/`
- [ ] Login with a real account (production has **no** master-OTP bypass — you need a real SMS code)
- [ ] Click through the same flows you verified on staging
- [ ] Watch Railway logs for the next 10 minutes — make sure no service is crash-looping

## Step 6 — Sync `staging` back

```
git checkout staging
git merge main             # should be a no-op fast-forward, but keeps refs aligned
git push origin staging    # only if anything actually changed
```

Then keep working on `staging` for the next iteration.

## Rollback

If production is broken and you need to undo the release:

```
git checkout main
git revert -m 1 <merge-commit-sha>      # the merge commit from Step 3
git push origin main
```

`-m 1` tells revert to keep `main`'s pre-merge state. This pushes a new commit that undoes the merge — cleaner history than force-pushing.

Railway redeploys on the revert push. Within ~2 minutes you're back to the previous working state.

After rolling back: don't try to re-release the same changes. Fix the underlying issue on `staging`, re-verify on staging, then release fresh.

## Hotfix exception

Skip `staging` only when production is on fire and the fix is small (one file, no migrations):

```
git checkout main
git pull
# ...edit, fix, commit...
git push origin main          # → production deploys

# Immediately backport so branches don't drift
git checkout staging
git merge main
git push origin staging
```

The backport step is non-optional. Skipping it means the next routine release will silently undo your hotfix.
