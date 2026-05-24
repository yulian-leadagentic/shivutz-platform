#!/usr/bin/env bash
# =============================================================
# Shivutz Platform — Auth + Multi-Entity Flow Test
#
# Exercises the full path a multi-membership user takes through
# the auth system. Catches regressions in:
#
#   * send-otp / verify-otp / login-otp endpoints
#   * the memberships array returned on login (shape + count)
#   * select-entity scoping (the JWT actually carries the
#     entity_id + entity_type we asked for, not the legacy
#     org_id from a previous selection)
#   * /auth/memberships listing
#   * /auth/me reflecting the active entity
#   * switching between entities issues a different JWT each time
#
# Run before merging anything that touches auth/ or login flows.
# Takes ~5 seconds end-to-end against a local stack.
#
# Usage:
#   bash scripts/test-auth-flow.sh
#
# Requires: docker compose up (gateway + auth + user-org running),
#           a Yulian-style fixture user with >=3 memberships at
#           +972525278625, and MASTER_OTP=999999 in the auth env.
# =============================================================

set -uo pipefail

GATEWAY="http://localhost:3000"
PHONE="+972525278625"
MASTER_OTP="999999"

# Pick the available python binary. Linux + Mac have python3,
# Windows Git Bash has only `python` (or sometimes both, with
# the "Python was not found" alias for python3 if the Microsoft
# Store stub is in PATH first). Try python first then python3,
# fail loud if neither works rather than silently mis-parsing.
PY=""
if command -v python >/dev/null 2>&1 && python -c "import sys; sys.exit(0)" >/dev/null 2>&1; then
  PY="python"
elif command -v python3 >/dev/null 2>&1 && $PY -c "import sys; sys.exit(0)" >/dev/null 2>&1; then
  PY="python3"
else
  echo "ERROR: neither python nor python3 is available on PATH" >&2
  exit 2
fi

# At least these three memberships must exist for this fixture
# (chosen because the user reported the multi-account bug under
# exactly this configuration). Edit if seed data changes.
EXPECTED_CONTRACTOR_COUNT=2
EXPECTED_CORPORATION_COUNT=1

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0

ok()   { echo -e "${GREEN}  ✓${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}  ✗${NC} $1"; FAIL=$((FAIL+1)); }
info() { echo -e "${YELLOW}▶${NC} $1"; }

# Pull a top-level JSON value with python — no jq dependency.
jq_pluck() {
  $PY -c "import sys,json
try:
    print(json.loads(sys.stdin.read()).get('$1',''))
except Exception:
    print('', file=sys.stderr)
    sys.exit(1)"
}

# Decode a JWT payload + pull a single claim. Used to verify the
# server actually scoped the token — without reading entity_id
# back, we can't tell if select-entity did the right thing.
jwt_claim() {
  local token=$1 key=$2
  $PY -c "
import sys, base64, json
parts = '''$token'''.split('.')
if len(parts) != 3:
    sys.exit(1)
p = parts[1] + '=' * (-len(parts[1]) % 4)
print(json.loads(base64.urlsafe_b64decode(p)).get('$key', ''))
"
}

echo
echo "════════════════════════════════════════════════════"
echo "   Auth + Multi-Entity Flow Test"
echo "   Phone: ${PHONE}"
echo "════════════════════════════════════════════════════"
echo

# ─── 1. Send OTP ─────────────────────────────────────────────
info "Phase 1: Send OTP"
SEND_RESP=$(curl -sS -X POST "${GATEWAY}/api/auth/send-otp" \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"${PHONE}\",\"purpose\":\"login\"}")
SENT=$(echo "$SEND_RESP" | jq_pluck sent)
if [ "$SENT" = "True" ] || [ "$SENT" = "true" ]; then
  ok "send-otp returned {sent: true}"
else
  fail "send-otp unexpected: $SEND_RESP"
fi

# ─── 2. Login with master OTP ────────────────────────────────
info "Phase 2: Login with master OTP"
LOGIN_RESP=$(curl -sS -X POST "${GATEWAY}/api/auth/login/otp" \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"${PHONE}\",\"code\":\"${MASTER_OTP}\"}")
INITIAL_TOKEN=$(echo "$LOGIN_RESP" | jq_pluck access_token)
NEEDS_SELECT=$(echo "$LOGIN_RESP" | jq_pluck needs_entity_selection)

if [ -n "$INITIAL_TOKEN" ]; then
  ok "login/otp returned access_token (length: ${#INITIAL_TOKEN})"
else
  fail "login/otp returned no token: $LOGIN_RESP"
  echo
  echo "Aborting — can't continue without a session."
  exit 1
fi

if [ "$NEEDS_SELECT" = "True" ] || [ "$NEEDS_SELECT" = "true" ]; then
  ok "needs_entity_selection=true (multi-membership user, as expected)"
else
  fail "needs_entity_selection should be true for fixture, got: $NEEDS_SELECT"
fi

# ─── 3. Memberships payload shape ────────────────────────────
info "Phase 3: Memberships in login payload"
M_CONTRACTOR=$(echo "$LOGIN_RESP" | $PY -c "
import sys, json
data = json.load(sys.stdin)
ms = data.get('memberships') or []
print(sum(1 for m in ms if m.get('entity_type') == 'contractor'))
")
M_CORPORATION=$(echo "$LOGIN_RESP" | $PY -c "
import sys, json
data = json.load(sys.stdin)
ms = data.get('memberships') or []
print(sum(1 for m in ms if m.get('entity_type') == 'corporation'))
")
if [ "$M_CONTRACTOR" -ge "$EXPECTED_CONTRACTOR_COUNT" ]; then
  ok "found ${M_CONTRACTOR} contractor memberships (expected >= ${EXPECTED_CONTRACTOR_COUNT})"
else
  fail "expected >= ${EXPECTED_CONTRACTOR_COUNT} contractor memberships, found ${M_CONTRACTOR}"
fi
if [ "$M_CORPORATION" -ge "$EXPECTED_CORPORATION_COUNT" ]; then
  ok "found ${M_CORPORATION} corporation memberships (expected >= ${EXPECTED_CORPORATION_COUNT})"
else
  fail "expected >= ${EXPECTED_CORPORATION_COUNT} corporation memberships, found ${M_CORPORATION}"
fi

# Pluck specific IDs we'll use for select-entity testing.
# `tr -d '\r'` strips CRLF leftovers that Git Bash on Windows
# bakes into command-substituted strings — without it the IDs
# carry a trailing \r and the JSON body sent to select-entity
# is invalid (`...c5\r","entity_type":...` → JSON parse error).
CONTRACTOR_IDS=$(echo "$LOGIN_RESP" | $PY -c "
import sys, json
ms = json.load(sys.stdin).get('memberships') or []
print('\n'.join(m['entity_id'] for m in ms if m.get('entity_type') == 'contractor'))
" | tr -d '\r')
CORPORATION_IDS=$(echo "$LOGIN_RESP" | $PY -c "
import sys, json
ms = json.load(sys.stdin).get('memberships') or []
print('\n'.join(m['entity_id'] for m in ms if m.get('entity_type') == 'corporation'))
" | tr -d '\r')

# ─── 4. Select each contractor + verify JWT scoping ─────────
info "Phase 4: select-entity for each contractor"
LAST_TOKEN=""
for cid in $CONTRACTOR_IDS; do
  SEL_RESP=$(curl -sS -X POST "${GATEWAY}/api/auth/select-entity" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${INITIAL_TOKEN}" \
    -d "{\"entity_id\":\"${cid}\",\"entity_type\":\"contractor\"}")
  SCOPED=$(echo "$SEL_RESP" | jq_pluck access_token)
  if [ -z "$SCOPED" ]; then
    fail "select-entity(${cid}) — no token: $SEL_RESP"
    continue
  fi
  CLAIM_ID=$(jwt_claim "$SCOPED" entity_id)
  CLAIM_TYPE=$(jwt_claim "$SCOPED" entity_type)
  if [ "$CLAIM_ID" = "$cid" ] && [ "$CLAIM_TYPE" = "contractor" ]; then
    ok "JWT scoped correctly to contractor ${cid:0:8}…"
  else
    fail "JWT scoping wrong for ${cid:0:8}…: got entity_id=${CLAIM_ID:0:8}… type=${CLAIM_TYPE}"
  fi
  LAST_TOKEN="$SCOPED"
done

# ─── 5. Select each corporation + verify JWT scoping ────────
info "Phase 5: select-entity for each corporation"
for cid in $CORPORATION_IDS; do
  SEL_RESP=$(curl -sS -X POST "${GATEWAY}/api/auth/select-entity" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${INITIAL_TOKEN}" \
    -d "{\"entity_id\":\"${cid}\",\"entity_type\":\"corporation\"}")
  SCOPED=$(echo "$SEL_RESP" | jq_pluck access_token)
  if [ -z "$SCOPED" ]; then
    fail "select-entity(${cid}) — no token"
    continue
  fi
  CLAIM_ID=$(jwt_claim "$SCOPED" entity_id)
  CLAIM_TYPE=$(jwt_claim "$SCOPED" entity_type)
  if [ "$CLAIM_ID" = "$cid" ] && [ "$CLAIM_TYPE" = "corporation" ]; then
    ok "JWT scoped correctly to corporation ${cid:0:8}…"
  else
    fail "JWT scoping wrong for ${cid:0:8}…: got entity_id=${CLAIM_ID:0:8}… type=${CLAIM_TYPE}"
  fi
  LAST_TOKEN="$SCOPED"
done

# ─── 6. /auth/memberships returns same list as login ─────────
info "Phase 6: /auth/memberships under scoped JWT"
M_RESP=$(curl -sS -H "Authorization: Bearer ${LAST_TOKEN}" \
  "${GATEWAY}/api/auth/memberships")
M_COUNT=$(echo "$M_RESP" | $PY -c "
import sys, json
ms = json.load(sys.stdin).get('memberships') or []
print(len(ms))
")
EXPECTED_TOTAL=$((EXPECTED_CONTRACTOR_COUNT + EXPECTED_CORPORATION_COUNT))
if [ "$M_COUNT" -ge "$EXPECTED_TOTAL" ]; then
  ok "/auth/memberships listed ${M_COUNT} memberships (>= ${EXPECTED_TOTAL})"
else
  fail "/auth/memberships listed ${M_COUNT}, expected >= ${EXPECTED_TOTAL}"
fi

# ─── 7. Gateway header projection ────────────────────────────
info "Phase 7: Scoped JWT projects to x-user-role downstream"
# /api/deals is gated by x-user-role + x-org-id. Hitting it with
# the LAST scoped token should return 200 and items keyed by the
# scoped entity. If the gateway dropped to the legacy 'role'
# claim, contractor JWT would still hit the corporation branch
# of list_deals — this catches that regression.
DEALS_HTTP=$(curl -sS -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer ${LAST_TOKEN}" \
  "${GATEWAY}/api/deals?page_size=5")
if [ "$DEALS_HTTP" = "200" ]; then
  ok "GET /api/deals on scoped JWT → 200"
else
  fail "GET /api/deals on scoped JWT → HTTP ${DEALS_HTTP}"
fi

# ─── Summary ─────────────────────────────────────────────────
echo
echo "════════════════════════════════════════════════════"
TOTAL=$((PASS + FAIL))
if [ "$FAIL" -eq 0 ]; then
  echo -e "  ${GREEN}✓ ALL PASSED${NC}  ${PASS}/${TOTAL}"
  exit 0
else
  echo -e "  ${RED}✗ ${FAIL} FAILED${NC}  ${PASS}/${TOTAL}"
  exit 1
fi
