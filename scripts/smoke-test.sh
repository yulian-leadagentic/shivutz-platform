#!/usr/bin/env bash
# =============================================================
# Shivutz Platform — Docker Smoke Test
# Usage: bash scripts/smoke-test.sh
# Requires: docker compose up --build -d  (run first)
# =============================================================

set -euo pipefail

GATEWAY="http://localhost:3000"
PASS=0
FAIL=0
RESULTS=()

# ─── Colours ─────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "${GREEN}  ✓ PASS${NC}  $1"; PASS=$((PASS+1)); RESULTS+=("PASS: $1"); }
fail() { echo -e "${RED}  ✗ FAIL${NC}  $1"; FAIL=$((FAIL+1)); RESULTS+=("FAIL: $1"); }
info() { echo -e "${YELLOW}  ▶${NC}  $1"; }

# ─── Wait for service ────────────────────────────────────────
wait_for() {
  local url=$1 name=$2 retries=30
  info "Waiting for $name..."
  for i in $(seq 1 $retries); do
    if curl -sf "$url" > /dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

echo ""
echo "════════════════════════════════════════════════════"
echo "   Shivutz Platform — Smoke Test"
echo "════════════════════════════════════════════════════"
echo ""

# ─── 1. Health Checks ────────────────────────────────────────
info "── Phase 1: Health Checks ──────────────────────────"

declare -A SERVICES=(
  ["Gateway (3000)"]="http://localhost:3000/health"
  ["Auth (3001)"]="http://localhost:3001/health"
  ["User-Org (3002)"]="http://localhost:3002/health"
  ["Worker (3003)"]="http://localhost:3003/health"
  ["Job-Match (3004)"]="http://localhost:3004/health"
  ["Deal (3005)"]="http://localhost:3005/health"
  ["Notification (3006)"]="http://localhost:3006/health"
  ["Admin (3007)"]="http://localhost:3007/health"
)

for name in "${!SERVICES[@]}"; do
  url="${SERVICES[$name]}"
  if wait_for "$url" "$name"; then
    status=$(curl -sf "$url" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null || echo "")
    if [ "$status" = "ok" ]; then
      ok "$name → {\"status\":\"ok\"}"
    else
      fail "$name → unexpected response: $status"
    fi
  else
    fail "$name → did not respond after 60s"
  fi
done

echo ""
info "── Phase 2: Auth Flow ──────────────────────────────"

# ─── 2. Register a test contractor ───────────────────────────
# Use -s only (not -f) so we can read 4xx response bodies (e.g. "email already registered")
REGISTER_RESP=$(curl -s -X POST "$GATEWAY/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke-test@shivutz.test","password":"Test1234!","role":"contractor"}' 2>&1)

if echo "$REGISTER_RESP" | grep -q '"id"'; then
  ok "POST /api/auth/register → 201 with user id"
elif echo "$REGISTER_RESP" | grep -q '"email already registered"'; then
  ok "POST /api/auth/register → user already exists (re-run)"
else
  fail "POST /api/auth/register → $REGISTER_RESP"
fi

# ─── 3. Login ────────────────────────────────────────────────
LOGIN_RESP=$(curl -sf -X POST "$GATEWAY/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke-test@shivutz.test","password":"Test1234!"}' 2>&1 || echo "ERROR")

if echo "$LOGIN_RESP" | grep -q '"access_token"'; then
  ok "POST /api/auth/login → 200 with access_token"
  TOKEN=$(echo "$LOGIN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])" 2>/dev/null || echo "")
else
  fail "POST /api/auth/login → $LOGIN_RESP"
  TOKEN=""
fi

# ─── 4. Bad credentials → 401 ────────────────────────────────
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$GATEWAY/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"nobody@example.com","password":"wrong"}')
if [ "$HTTP_CODE" = "401" ]; then
  ok "POST /api/auth/login (bad creds) → 401"
else
  fail "POST /api/auth/login (bad creds) → expected 401, got $HTTP_CODE"
fi

echo ""
info "── Phase 3: Enum Endpoint ──────────────────────────"

# ─── 5. Professions (public via worker service) ───────────────
PROFS=$(curl -sf "$GATEWAY/api/enums/professions" 2>&1 || echo "ERROR")
if echo "$PROFS" | grep -q '"flooring"'; then
  COUNT=$(echo "$PROFS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  ok "GET /api/enums/professions → $COUNT professions seeded"
else
  fail "GET /api/enums/professions → $PROFS"
fi

echo ""
info "── Phase 4: RBAC Guards ────────────────────────────"

# ─── 6. Admin endpoint without token → 401 ───────────────────
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$GATEWAY/api/admin/dashboard")
if [ "$CODE" = "401" ]; then
  ok "GET /api/admin/dashboard (no token) → 401"
else
  fail "GET /api/admin/dashboard (no token) → expected 401, got $CODE"
fi

# ─── 7. Admin endpoint with contractor token → 403 ───────────
if [ -n "$TOKEN" ]; then
  CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $TOKEN" "$GATEWAY/api/admin/dashboard")
  if [ "$CODE" = "403" ]; then
    ok "GET /api/admin/dashboard (contractor token) → 403"
  else
    fail "GET /api/admin/dashboard (contractor token) → expected 403, got $CODE"
  fi
else
  fail "GET /api/admin/dashboard (contractor token) → skipped (no token)"
fi

# ─── Summary ─────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════"
echo -e "   Results: ${GREEN}$PASS passed${NC}  ${RED}$FAIL failed${NC}"
echo "════════════════════════════════════════════════════"

if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}  All checks passed — ready for development!${NC}"
  exit 0
else
  echo -e "${RED}  $FAIL check(s) failed — see above for details.${NC}"
  exit 1
fi
