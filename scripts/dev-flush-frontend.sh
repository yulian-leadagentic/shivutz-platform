#!/usr/bin/env bash
# =============================================================
# Shivutz Platform — Local frontend cache flush
#
# When Turbopack's chunk hashes drift out of sync with whatever
# the browser holds open from an earlier session, you get a
# `ChunkLoadError` on next navigation (e.g.
# "Failed to load chunk /_next/static/chunks/src_app_..._hit._.js").
# The page route itself still 200s — only the `<script src>` it
# references no longer exists on disk.
#
# This script:
#   1. Stops the frontend container.
#   2. Force-removes any orphaned exited container that is still
#      pinning the cache volume (docker leaves these behind every
#      time the frontend gets `--build`-ed in another command).
#   3. Drops the named volume `shivutz-platform_frontend_next_cache`.
#   4. Brings the frontend back up; the first page load triggers
#      a clean Turbopack compile against the current source tree.
#
# Usage:
#   bash scripts/dev-flush-frontend.sh
#
# After it finishes: hard-refresh your browser tab (Ctrl+Shift+R)
# so the browser drops references to the old chunk paths too.
# =============================================================

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info() { echo -e "${YELLOW}▶${NC}  $1"; }
ok()   { echo -e "${GREEN}✓${NC}  $1"; }
warn() { echo -e "${RED}⚠${NC}  $1"; }

CONTAINER="shivutz-platform-frontend-1"
VOLUME="shivutz-platform_frontend_next_cache"
URL="http://localhost:3008/"

# 1. Stop the frontend (no-op if already stopped).
info "Stopping frontend container..."
docker compose stop frontend > /dev/null 2>&1 || true
ok "Stopped"

# 2. Remove ANY exited container still holding the cache volume.
#    docker leaves these orphans behind whenever the frontend image
#    was rebuilt — and they pin the volume, so `volume rm` fails.
#    `docker volume inspect` lists the mountpoint owners.
info "Removing orphan containers holding the cache volume..."
ORPHANS=$(docker ps -a --filter "volume=${VOLUME}" --format "{{.ID}}" || true)
if [ -n "${ORPHANS}" ]; then
  echo "${ORPHANS}" | xargs -r docker rm -f > /dev/null
  ok "Removed: ${ORPHANS}"
else
  ok "No orphans"
fi

# 3. Drop the volume. If something is still pinning it, surface
#    the error so the dev knows to look closer (rather than racing
#    on to step 4 and silently leaving the stale cache in place).
info "Dropping volume ${VOLUME}..."
if docker volume rm "${VOLUME}" > /dev/null 2>&1; then
  ok "Dropped"
else
  warn "Volume could not be removed — it may not exist (fine) or"
  warn "something else is still mounting it. Run:"
  warn "  docker ps -a --filter volume=${VOLUME}"
  warn "to see what's holding it."
fi

# 4. Bring frontend back up. Override file is auto-applied.
info "Starting frontend..."
docker compose up -d frontend > /dev/null
ok "Started"

# 5. Wait for the dev server to respond. First request triggers
#    a cold compile, so this can take 5-15s on a clean cache.
info "Waiting for dev server at ${URL}..."
for i in $(seq 1 60); do
  if curl -fsS "${URL}" > /dev/null 2>&1; then
    ok "Ready (after ${i}s)"
    break
  fi
  sleep 1
done

echo
ok "Cache flushed. Now hard-refresh your browser (Ctrl+Shift+R)."
