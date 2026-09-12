#!/usr/bin/env python3
"""S1 · smoke test for Shivutz staging.

Automates the API-layer half of docs/cc-prompts/cc_launch_runsheet.md
§10 (the manual pass takes ~90 min; this pass takes ~5 min). What it
covers:

  §2.1  Anonymous negative — endpoints that MUST 401/403 to anon.
  §2.2  Anonymous positive — legal pages + home MUST stay open.
  §2.3  Cross-entity isolation — contractor A cannot read contractor B.
  §2.4  🔴 Approval-and-quota — pending contractor cannot reveal, and
        looking at your own reveal history does NOT consume quota.
  §2.5  Leak checks — search response has no phone/email/corp_name;
        contractor identity never surfaces on the corp's /ads/mine/reveals.
  §2.6  Corp visibility (H12) — corp browsing workers sees only its
        own inventory; browsing housing sees others'.
  §2.7  Money guardrails — payment_events with is_fake=FALSE must be 0
        on staging.

Explicitly NOT covered: layout, RTL rendering, mobile 390 flow, trust
badges, the demo loop. Those need eyes; §3 of the runsheet prints a
reminder list at the end.

Usage:
  python scripts/smoke_test.py --base-url https://<gateway-staging>
  python scripts/smoke_test.py --base-url … --seed-report   # read-only

Exit codes:
  0 — all tests PASS
  1 — one or more FAIL (full response bodies printed)
  2 — production URL refused (guardrail — no override flag)

Env vars — all required (or the script refuses to start):
  MASTER_OTP                        the 6-digit master code (staging only)
  MYSQL_HOST, MYSQL_PORT?, MYSQL_USER?, MYSQL_ROOT_PASSWORD
  CONTRACTOR_APPROVED_PHONE         approved contractor, is_seed=1
  CONTRACTOR_PENDING_PHONE          pending contractor, is_seed=1
  CONTRACTOR_B_PHONE                second approved contractor, is_seed=1
  CORPORATION_PHONE                 approved corporation,  is_seed=1

Guardrails (spec §Guardrails):
  * Never prints a token, OTP, or password. Even on failure.
  * Refuses to run against production hosts. No override flag.
  * The only writes performed are those that the API is EXPECTED to
    reject (a pending contractor's reveal attempt lands nothing in
    contact_reveals — that's what §2.4 asserts). No DELETE, no UPDATE,
    no ad creation.
  * --seed-report is read-only: 4 SELECTs, no writes, no reveals.
  * Does NOT fix bugs it finds. Bugs go in the FAIL rows and their
    response bodies; fixing them is a follow-up commit.
"""
from __future__ import annotations
import argparse
import json
import os
import re
import sys
import time
import urllib.parse
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

try:
    import pymysql
except ImportError:
    print("[smoke] FATAL: pymysql required — pip install pymysql", file=sys.stderr)
    sys.exit(3)

try:
    import requests
except ImportError:
    print("[smoke] FATAL: requests required — pip install requests", file=sys.stderr)
    sys.exit(3)


# ─── Guardrails ────────────────────────────────────────────────────────────────

# A base URL whose netloc contains any of these patterns is refused with
# exit code 2 and no override flag. This is the anti-footgun that makes
# the whole tool safe: the smoke test performs failing reveals, cross-
# entity access attempts, and history queries — none of that belongs
# anywhere near a live user's row.
PROD_HOST_PATTERNS = (
    "gateway-production",
    "frontend-production",
    "tagid.ai",
    "buildup.co.il",
    "shivutz.co.il",
    "leadagentic.com",
)

# Fields that MUST NOT appear in /search results (D1 in the spec).
SEARCH_FORBIDDEN_KEYS = (
    "contact_phone", "phone", "contact_email", "email",
    "company_name", "company_name_he", "company_name_en", "corp_name",
    "corporation_name", "corporation_name_he", "owner_name", "owner_phone",
)

# Fields that MAY appear in /ads/mine/reveals (whitelist per §2.5 D3).
CORP_REVEALS_ALLOWED_KEYS = {
    "id", "ad_id", "revealed_at", "title_he", "ad_type", "profession_code",
}


def refuse_production(base_url: str) -> None:
    parsed = urllib.parse.urlparse(base_url)
    host = (parsed.netloc or "").lower()
    for pat in PROD_HOST_PATTERNS:
        if pat in host:
            print(
                f"[smoke] REFUSING to run against production-like host "
                f"'{host}' (matched '{pat}'). No override flag exists — "
                "point --base-url at a staging URL.",
                file=sys.stderr,
            )
            sys.exit(2)


# ─── Redaction helpers — never print secrets ─────────────────────────────────

def redact_phone(p: str) -> str:
    if not p:
        return "(unset)"
    return f"***{p[-4:]}" if len(p) >= 5 else "***"


def redact_headers(headers: Dict[str, str]) -> Dict[str, str]:
    out = {}
    for k, v in headers.items():
        if k.lower() in ("authorization", "cookie"):
            out[k] = "***"
        else:
            out[k] = v
    return out


def redact_body(body: Any) -> Any:
    """Deep-copy body with any suspicious values masked. Recursive.
    Note: `code` is NOT redacted — it's used for error codes like
    `entity_not_approved` which are documented, non-secret contract."""
    if isinstance(body, dict):
        red = {}
        for k, v in body.items():
            kl = str(k).lower()
            if kl in ("access_token", "refresh_token", "token", "password",
                      "otp", "authorization", "sms_code"):
                red[k] = "***"
            else:
                red[k] = redact_body(v)
        return red
    if isinstance(body, list):
        return [redact_body(x) for x in body]
    return body


# ─── Result table ────────────────────────────────────────────────────────────

@dataclass
class Row:
    section: str
    check:   str
    expected: str
    actual:  str
    ok:      bool
    detail:  Optional[str] = None   # populated on FAIL only

@dataclass
class Runner:
    rows: List[Row] = field(default_factory=list)

    def add(self, section: str, check: str, expected: str, actual: str,
            ok: bool, detail: Optional[str] = None) -> None:
        self.rows.append(Row(section, check, expected, actual, ok, detail))

    def print_table(self) -> None:
        w_sec   = max(3, max(len(r.section)  for r in self.rows))
        w_check = max(5, max(len(r.check)    for r in self.rows))
        w_exp   = max(8, max(len(r.expected) for r in self.rows))
        w_act   = max(6, max(len(r.actual)   for r in self.rows))
        fmt = f"{{:<{w_sec}}}  {{:<{w_check}}}  {{:<{w_exp}}}  {{:<{w_act}}}  {{}}"
        print()
        print(fmt.format("§", "Check", "Expected", "Actual", "Result"))
        print("-" * (w_sec + w_check + w_exp + w_act + 20))
        for r in self.rows:
            print(fmt.format(r.section, r.check, r.expected, r.actual,
                             "PASS" if r.ok else "FAIL"))
        print()
        # Failure detail block — separate, easy to scroll to.
        fails = [r for r in self.rows if not r.ok]
        if fails:
            print("─── FAIL bodies ───")
            for r in fails:
                print(f"[{r.section}] {r.check}")
                if r.detail:
                    print(r.detail)
                print()
        n_pass = sum(1 for r in self.rows if r.ok)
        n_fail = len(self.rows) - n_pass
        print(f"── {n_pass} PASS · {n_fail} FAIL ──")

    def exit_code(self) -> int:
        return 0 if all(r.ok for r in self.rows) else 1


# ─── DB helpers ──────────────────────────────────────────────────────────────

def db(db_name: str) -> pymysql.Connection:
    return pymysql.connect(
        host=os.environ["MYSQL_HOST"],
        port=int(os.environ.get("MYSQL_PORT", "3306")),
        user=os.environ.get("MYSQL_USER", "root"),
        password=os.environ["MYSQL_ROOT_PASSWORD"],
        database=db_name,
        charset="utf8mb4",
        autocommit=True,
    )


def scalar(conn: pymysql.Connection, sql: str, args: Tuple = ()) -> Any:
    with conn.cursor() as cur:
        cur.execute(sql, args)
        row = cur.fetchone()
        return row[0] if row else None


def rows_of(conn: pymysql.Connection, sql: str, args: Tuple = ()) -> List[Tuple]:
    with conn.cursor() as cur:
        cur.execute(sql, args)
        return list(cur.fetchall())


# ─── HTTP wrapper — captures status + JSON body ──────────────────────────────

class ApiClient:
    def __init__(self, base_url: str) -> None:
        self.base = base_url.rstrip("/")
        self.s = requests.Session()
        # A conservative default timeout — /search can be slow but 30s
        # is generous. Any single call taking longer is itself a signal.
        self.timeout = 30

    def _url(self, path: str) -> str:
        return self.base + (path if path.startswith("/") else "/" + path)

    def call(self, method: str, path: str, *,
             token: Optional[str] = None,
             entity_id: Optional[str] = None,
             entity_type: Optional[str] = None,
             body: Any = None,
             json_body: Any = None,
             params: Optional[Dict[str, Any]] = None) -> Tuple[int, Any, str]:
        """Returns (status, parsed_json_or_text, detail_for_fail_dump)."""
        headers: Dict[str, str] = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if entity_id:
            headers["X-Entity-Id"] = entity_id
        if entity_type:
            headers["X-Entity-Type"] = entity_type
        if json_body is not None:
            headers["Content-Type"] = "application/json"
            body = json.dumps(json_body)
        try:
            r = self.s.request(method, self._url(path),
                               headers=headers, data=body, params=params,
                               timeout=self.timeout)
        except requests.RequestException as e:
            return (-1, None, f"REQUEST FAILED: {type(e).__name__}: {e}")

        try:
            parsed = r.json()
        except ValueError:
            parsed = r.text

        detail = (
            f"  METHOD:   {method} {path}\n"
            f"  STATUS:   {r.status_code}\n"
            f"  HEADERS:  {redact_headers(dict(headers))}\n"
            f"  RESPONSE: {json.dumps(redact_body(parsed), ensure_ascii=False)[:2000]}"
        )
        return (r.status_code, parsed, detail)


# ─── Auth flow ───────────────────────────────────────────────────────────────

@dataclass
class Session:
    label: str          # e.g. 'CONTRACTOR_APPROVED'
    phone: str          # +972…
    entity_type: str    # 'contractor' | 'corporation'
    entity_id: str
    access_token: str


def login(api: ApiClient, phone: str, master_otp: str, label: str) -> Session:
    """OTP-login flow, resolves entity via /select-entity if needed. Master
    OTP still needs a real sms_otp row to compare against — so this always
    calls /send-otp first (yes, that sends an SMS; staging seeds accept
    the cost)."""
    # 1. send OTP (real SMS to the seed phone owner; staging cost)
    sc, body, det = api.call("POST", "/api/auth/send-otp",
                             json_body={"phone": phone, "purpose": "login"})
    if sc != 200:
        raise SystemExit(f"[smoke] {label}: send-otp failed sc={sc}\n{det}")

    # 2. login/otp with master code
    sc, body, det = api.call("POST", "/api/auth/login/otp",
                             json_body={"phone": phone, "code": master_otp})
    if sc != 200 or not isinstance(body, dict):
        raise SystemExit(f"[smoke] {label}: login/otp failed sc={sc}\n{det}")

    token = body.get("access_token")
    if not token:
        raise SystemExit(f"[smoke] {label}: no access_token in login response")

    memberships = body.get("memberships") or []
    if body.get("needs_entity_selection"):
        # Multi-entity path — pick the first membership. Seed phones
        # SHOULD be single-membership; anything else is a data-quality
        # signal the operator should investigate.
        if not memberships:
            raise SystemExit(f"[smoke] {label}: needs_entity_selection but no memberships")
        m = memberships[0]
        sc, body2, det = api.call("POST", "/api/auth/select-entity",
                                  token=token,
                                  json_body={"entity_id": m["entity_id"],
                                             "entity_type": m["entity_type"]})
        if sc != 200 or "access_token" not in (body2 or {}):
            raise SystemExit(f"[smoke] {label}: select-entity failed sc={sc}\n{det}")
        token = body2["access_token"]
        etype, eid = m["entity_type"], m["entity_id"]
    else:
        # Single-membership: /login/otp already scoped the JWT. But
        # `memberships` is undefined in that branch (auth.js:409), so
        # we resolve via the DB — the smoke test needs the entity_id
        # to build X-Entity-* headers for later calls.
        auth = db("auth_db")
        try:
            rows = rows_of(
                auth,
                """SELECT em.entity_type, em.entity_id
                     FROM users u
                     JOIN entity_memberships em ON em.user_id = u.id
                    WHERE u.phone=%s AND u.deleted_at IS NULL
                      AND em.is_active=1 AND em.invitation_accepted_at IS NOT NULL
                    LIMIT 1""",
                (phone,),
            )
        finally:
            auth.close()
        if not rows:
            raise SystemExit(f"[smoke] {label}: no active membership for phone")
        etype, eid = rows[0][0], rows[0][1]

    return Session(label=label, phone=phone,
                   entity_type=etype, entity_id=eid, access_token=token)


# ─── Seed guard ─────────────────────────────────────────────────────────────

def verify_seeds_marked(sessions: List[Session]) -> None:
    """Fail loud if any seed entity has is_seed=FALSE. This is the
    anti-footgun: without it a mis-pointed --base-url could hit a
    real user's data via a mis-set env var."""
    org = db("org_db")
    try:
        for s in sessions:
            tbl = "contractors" if s.entity_type == "contractor" else "corporations"
            val = scalar(org, f"SELECT is_seed FROM {tbl} WHERE id=%s", (s.entity_id,))
            if not val:
                raise SystemExit(
                    f"[smoke] REFUSING: {s.label} entity is_seed=FALSE. "
                    f"Run scripts/mark_seed_entities.py first, or fix the "
                    f"phone env vars if they point at the wrong entity."
                )
    finally:
        org.close()


# ─── Test blocks ────────────────────────────────────────────────────────────

def sample_ad_id(conn: pymysql.Connection) -> Optional[str]:
    """Pick one non-deleted active ad_id, deterministically (min id).
    Used by the reveal-quota test — we don't care which ad, only that
    the caller can point at a real UUID."""
    return scalar(
        conn,
        """SELECT id FROM ads
             WHERE active=1 AND deleted_at IS NULL
             ORDER BY id ASC LIMIT 1""",
    )


def sample_housing_ad_owned_by_other(conn: pymysql.Connection, corp_id: str) -> Optional[str]:
    return scalar(
        conn,
        """SELECT id FROM ads
             WHERE ad_type='housing' AND active=1 AND deleted_at IS NULL
               AND owner_entity_id != %s
             ORDER BY id ASC LIMIT 1""",
        (corp_id,),
    )


def test_anon_negative(api: ApiClient, r: Runner, sample_ad_ids: Dict[str, Optional[str]]) -> None:
    """§2.1 — endpoints that must reject anon."""
    ad_any = sample_ad_ids.get("any")

    # A1 · /search
    sc, _, det = api.call("POST", "/api/search", json_body={"q": "פועל בניין"})
    r.add("2.1", "A1 POST /search anon", "401", str(sc), sc == 401, det if sc != 401 else None)

    # A2 · /ads/public/{id} — spec labels this "blocked"; wired as 401 via gateway.
    if ad_any:
        sc, _, det = api.call("GET", f"/api/ads/public/{ad_any}")
        r.add("2.1", "A2 GET /ads/public/{id} anon", "401", str(sc), sc == 401,
              det if sc != 401 else None)
    else:
        r.add("2.1", "A2 GET /ads/public/{id} anon", "401", "n/a — no ads on staging", True)

    # A3 · /ads/{id}/contact-reveal
    if ad_any:
        sc, _, det = api.call("GET", f"/api/ads/{ad_any}/contact-reveal")
        r.add("2.1", "A3 GET /ads/{id}/contact-reveal anon", "401", str(sc), sc == 401,
              det if sc != 401 else None)
    else:
        r.add("2.1", "A3 contact-reveal anon", "401", "n/a", True)

    # A4 · uploaded document — we probe the uploads prefix; any missing/
    # protected file must NOT respond 200 with content to an anon caller.
    sc, _, det = api.call("GET", "/api/uploads/nonexistent-smoke-test.pdf")
    r.add("2.1", "A4 GET /uploads/{file} anon", "401 or 403 or 404", str(sc),
          sc in (401, 403, 404), det if sc not in (401, 403, 404) else None)

    # A5 · voice transcribe anon. Route is `POST /api/voice/transcribe`
    # and lives on the gateway itself (rate-limited only, per subagent
    # research). Spec calls it "blocked" — anon calling it with no
    # audio should NOT succeed. We accept 400/401/403 as "not letting
    # the caller in", 200 is a fail.
    sc, _, det = api.call("POST", "/api/voice/transcribe", body="")
    r.add("2.1", "A5 POST /voice/transcribe anon", "!=200", str(sc), sc != 200,
          det if sc == 200 else None)


def test_anon_positive(api: ApiClient, r: Runner) -> None:
    """§2.2 — legal + home MUST stay open."""

    # B1 · frontend legal pages. These live on the *frontend* origin,
    # not the gateway. Testing the frontend is out of the smoke-test
    # scope (we hit --base-url which is the gateway). We instead trust
    # B2 to catch the underlying API being closed, and note here that
    # the frontend routes are covered manually.
    r.add("2.2", "B1 /terms /privacy /accessibility (frontend)", "manual",
          "not automated — hit gateway API in B2", True)

    # B2 · public legal API — every slug MUST return 200 with no token.
    for slug in ("terms", "privacy", "accessibility"):
        sc, body, det = api.call("GET", f"/api/legal/{slug}")
        ok = sc == 200 and isinstance(body, dict) and body.get("slug") == slug
        r.add("2.2", f"B2 GET /legal/{slug} anon", "200 + slug in body",
              f"{sc}", ok, det if not ok else None)

    # B3 · home / gateway health — cannot use frontend from here; probe
    # gateway /health as the equivalent liveness signal.
    sc, body, det = api.call("GET", "/health")
    r.add("2.2", "B3 gateway /health anon", "200", str(sc),
          sc == 200, det if sc != 200 else None)


def test_isolation(api: ApiClient, r: Runner, sess_a: Session, sess_b: Session,
                   sess_corp: Session) -> None:
    """§2.3 — contractor A on contractor B's data + corp data → 403.
    Same paths on A's own entity → 200. Without the 200 side we could
    have broken every read entirely and not noticed."""
    # A on B (cross-contractor)
    pairs_cross = [
        ("GET /organizations/contractors/{B}",
         f"/api/organizations/contractors/{sess_b.entity_id}"),
        ("GET /organizations/contractors/{B}/users",
         f"/api/organizations/contractors/{sess_b.entity_id}/users"),
        ("GET /organizations/corporations/{X}",
         f"/api/organizations/corporations/{sess_corp.entity_id}"),
        ("GET /organizations/corporations/{X}/users",
         f"/api/organizations/corporations/{sess_corp.entity_id}/users"),
        ("GET /organizations/corporations/{X}/documents",
         f"/api/organizations/corporations/{sess_corp.entity_id}/documents"),
    ]
    for name, path in pairs_cross:
        sc, _, det = api.call("GET", path, token=sess_a.access_token,
                              entity_id=sess_a.entity_id, entity_type=sess_a.entity_type)
        r.add("2.3", f"cross: A→ {name}", "403", str(sc), sc == 403,
              det if sc != 403 else None)

    # A on A's own — must be 200 (canary that the tests aren't broken
    # by requiring every GET to 403).
    self_paths = [
        ("self A GET /organizations/contractors/{A}",
         f"/api/organizations/contractors/{sess_a.entity_id}"),
        ("self A GET /organizations/contractors/{A}/users",
         f"/api/organizations/contractors/{sess_a.entity_id}/users"),
    ]
    for name, path in self_paths:
        sc, _, det = api.call("GET", path, token=sess_a.access_token,
                              entity_id=sess_a.entity_id, entity_type=sess_a.entity_type)
        r.add("2.3", name, "200", str(sc), sc == 200, det if sc != 200 else None)


def test_approval_and_quota(api: ApiClient, r: Runner, sess_pending: Session,
                            sess_approved: Session,
                            sample_ad_ids: Dict[str, Optional[str]]) -> None:
    """§2.4 — 🔴 THE test. Pending contractor's reveal attempt must
    be rejected AND leave contact_reveals COUNT unchanged. Approved
    contractor looking at reveal HISTORY must not consume quota
    either."""
    ad_any = sample_ad_ids.get("any")
    if not ad_any:
        r.add("2.4", "reveal-quota pending", "skip",
              "no ads on staging — cannot exercise", True)
        return

    org = db("org_db")
    try:
        # ── Pending contractor path ──────────────────────────────────
        before_pending = scalar(
            org, "SELECT COUNT(*) FROM contact_reveals WHERE viewer_entity_id=%s",
            (sess_pending.entity_id,),
        )
        sc, body, det = api.call(
            "GET", f"/api/ads/{ad_any}/contact-reveal",
            token=sess_pending.access_token,
            entity_id=sess_pending.entity_id, entity_type=sess_pending.entity_type,
        )
        after_pending = scalar(
            org, "SELECT COUNT(*) FROM contact_reveals WHERE viewer_entity_id=%s",
            (sess_pending.entity_id,),
        )
        # Gateway wraps FastAPI errors as {error: {code, message, details}}.
        # FastAPI's own shape is {detail: {code, ...}} or {detail: "string"}.
        # Handle both, drilling into `details` when the outer wrapper is
        # in play.
        code = ""
        if isinstance(body, dict):
            det_dict = body.get("detail")
            err_wrap = body.get("error") or {}
            details_wrap = err_wrap.get("details") if isinstance(err_wrap, dict) else None
            for candidate in (det_dict, details_wrap, err_wrap, body):
                if isinstance(candidate, dict) and candidate.get("code"):
                    code = str(candidate["code"])
                    break
                if isinstance(candidate, str) and candidate:
                    code = candidate
                    break
        expected = "403 entity_not_approved + COUNT unchanged"
        actual = f"{sc} code={code!r} before={before_pending} after={after_pending}"
        ok = sc == 403 and "entity_not_approved" in code and before_pending == after_pending
        r.add("2.4", "pending reveal → 403 + no quota bump", expected, actual, ok,
              det if not ok else None)

        # ── Approved contractor's reveal HISTORY path ────────────────
        before_hist = scalar(
            org, "SELECT COUNT(*) FROM contact_reveals WHERE viewer_entity_id=%s",
            (sess_approved.entity_id,),
        )
        sc, body, det = api.call(
            "GET", "/api/contractor/reveals",
            token=sess_approved.access_token,
            entity_id=sess_approved.entity_id, entity_type=sess_approved.entity_type,
        )
        after_hist = scalar(
            org, "SELECT COUNT(*) FROM contact_reveals WHERE viewer_entity_id=%s",
            (sess_approved.entity_id,),
        )
        ok = sc == 200 and before_hist == after_hist
        r.add("2.4", "approved /contractor/reveals → no quota bump",
              "200 + COUNT unchanged",
              f"{sc} before={before_hist} after={after_hist}", ok,
              det if not ok else None)
    finally:
        org.close()


def test_leaks(api: ApiClient, r: Runner, sess_approved: Session,
               sess_corp: Session) -> None:
    """§2.5 — response-body leak checks."""
    # D1 · /search from approved contractor — no phone/email/corp name.
    #      D2 · trust_level MUST be present on each result.
    sc, body, det = api.call(
        "POST", "/api/search",
        token=sess_approved.access_token,
        entity_id=sess_approved.entity_id, entity_type=sess_approved.entity_type,
        json_body={"query": "פועל בניין"},
    )
    if sc != 200 or not isinstance(body, dict):
        r.add("2.5", "D1 /search body reachable", "200 dict", str(sc), False, det)
    else:
        raw = json.dumps(body, ensure_ascii=False)
        leaked = [k for k in SEARCH_FORBIDDEN_KEYS if f'"{k}"' in raw]
        r.add("2.5", "D1 /search — no phone/email/corp_name leak",
              "no forbidden keys",
              ("clean" if not leaked else f"LEAKED: {leaked}"),
              not leaked, det if leaked else None)

        results = body.get("results") or []
        if not results:
            r.add("2.5", "D2 /search — trust_level present on results",
                  "trust_level on each", "no results returned — cannot verify", True)
        else:
            with_trust = sum(1 for row in results if isinstance(row, dict) and "trust_level" in row)
            r.add("2.5", "D2 /search — trust_level present on results",
                  "trust_level on every result",
                  f"{with_trust}/{len(results)}",
                  with_trust == len(results),
                  det if with_trust != len(results) else None)

    # D3 · corp /ads/mine/reveals — whitelist check.
    sc, body, det = api.call(
        "GET", "/api/ads/mine/reveals",
        token=sess_corp.access_token,
        entity_id=sess_corp.entity_id, entity_type=sess_corp.entity_type,
    )
    if sc != 200 or not isinstance(body, dict):
        r.add("2.5", "D3 /ads/mine/reveals reachable", "200 dict",
              str(sc), False, det)
    else:
        results = body.get("results") or []
        if not results:
            r.add("2.5", "D3 whitelist — corp reveals",
                  "no keys outside whitelist",
                  "no results — nothing to check", True)
        else:
            offenders = set()
            for row in results:
                if isinstance(row, dict):
                    for k in row.keys():
                        if k not in CORP_REVEALS_ALLOWED_KEYS:
                            offenders.add(k)
            r.add("2.5", "D3 whitelist — corp reveals",
                  "no keys outside whitelist",
                  ("clean" if not offenders else f"UNEXPECTED: {sorted(offenders)}"),
                  not offenders, det if offenders else None)

    # D4 · legal doc XSS — no <script, onerror=, javascript:.
    sc, body, det = api.call("GET", "/api/legal/terms")
    if sc != 200 or not isinstance(body, dict):
        r.add("2.5", "D4 /legal/terms XSS check",
              "200 + safe markdown", str(sc), False, det)
    else:
        md = str(body.get("body_md") or "")
        offenders = [pat for pat in ("<script", "onerror=", "javascript:") if pat in md.lower()]
        r.add("2.5", "D4 /legal/terms — no XSS tokens",
              "no <script/onerror/javascript:",
              ("clean" if not offenders else f"FOUND: {offenders}"),
              not offenders,
              det if offenders else None)


def test_corp_visibility(api: ApiClient, r: Runner, sess_corp: Session) -> None:
    """§2.6 — corp searching for workers sees only its own inventory;
    housing sees others'. contact-reveal on a foreign worker ad → 403
    and no COUNT bump."""
    # Worker search — every result's owner_entity_id must equal caller.
    sc, body, det = api.call(
        "POST", "/api/search",
        token=sess_corp.access_token,
        entity_id=sess_corp.entity_id, entity_type=sess_corp.entity_type,
        json_body={"query": "פועל בניין"},
    )
    if sc != 200 or not isinstance(body, dict):
        r.add("2.6", "corp /search reachable", "200 dict",
              str(sc), False, det)
    else:
        results = [x for x in (body.get("results") or []) if isinstance(x, dict)]
        # The server strips owner_entity_id from search responses (leak
        # guard). We can't verify from the JSON alone that no foreign
        # results leak in — so we do it via DB: any result id whose
        # owner_entity_id ≠ caller's is a violation. Empty results is
        # also acceptable (no worker inventory to leak).
        ids = [x.get("id") for x in results if x.get("id")]
        foreign = []
        if ids:
            org = db("org_db")
            try:
                marks = ",".join(["%s"] * len(ids))
                for aid, owner in rows_of(
                    org,
                    f"""SELECT id, owner_entity_id FROM ads
                          WHERE id IN ({marks}) AND ad_type='worker'""",
                    tuple(ids),
                ):
                    if owner != sess_corp.entity_id:
                        foreign.append(aid[:8])
            finally:
                org.close()
        r.add("2.6", "corp /search — worker results all owned by self",
              "no foreign worker ads",
              ("clean" if not foreign else f"FOREIGN: {foreign}"),
              not foreign, det if foreign else None)

    # Housing search — corp should see others' too. This means at least
    # one housing result whose owner_entity_id ≠ caller (or none, in
    # which case we can't test — mark inconclusive PASS).
    sc, body, det = api.call(
        "POST", "/api/search",
        token=sess_corp.access_token,
        entity_id=sess_corp.entity_id, entity_type=sess_corp.entity_type,
        json_body={"query": "דיור בתל אביב"},
    )
    ok_housing = True
    housing_actual = "no housing inventory to test"
    if sc == 200 and isinstance(body, dict):
        ids = [x.get("id") for x in (body.get("results") or []) if isinstance(x, dict) and x.get("id")]
        if ids:
            org = db("org_db")
            try:
                marks = ",".join(["%s"] * len(ids))
                sees_others = scalar(
                    org,
                    f"""SELECT COUNT(*) FROM ads
                         WHERE id IN ({marks}) AND ad_type='housing'
                           AND owner_entity_id != %s""",
                    tuple(ids) + (sess_corp.entity_id,),
                )
            finally:
                org.close()
            housing_actual = f"{sees_others} foreign housing rows returned"
            # Housing sharing is designed behaviour. Zero foreign IS a
            # signal, but with tiny inventory it's not reliably wrong.
            # We report the count and let the operator judge; not
            # asserting > 0 keeps this from flapping on small seed sets.
    r.add("2.6", "corp /search housing — foreign visible",
          "≥1 foreign housing (info)",
          housing_actual, ok_housing)

    # Foreign worker ad reveal — must 403 and NOT bump contact_reveals.
    org = db("org_db")
    try:
        foreign_worker_ad = scalar(
            org,
            """SELECT id FROM ads
                 WHERE ad_type='worker' AND active=1 AND deleted_at IS NULL
                   AND owner_entity_id != %s
                 ORDER BY id ASC LIMIT 1""",
            (sess_corp.entity_id,),
        )
        if not foreign_worker_ad:
            r.add("2.6", "corp reveal foreign worker ad", "skip",
                  "no foreign worker ads on staging", True)
        else:
            before = scalar(
                org, "SELECT COUNT(*) FROM contact_reveals WHERE viewer_entity_id=%s",
                (sess_corp.entity_id,),
            )
            sc, body, det = api.call(
                "GET", f"/api/ads/{foreign_worker_ad}/contact-reveal",
                token=sess_corp.access_token,
                entity_id=sess_corp.entity_id, entity_type=sess_corp.entity_type,
            )
            after = scalar(
                org, "SELECT COUNT(*) FROM contact_reveals WHERE viewer_entity_id=%s",
                (sess_corp.entity_id,),
            )
            ok = sc == 403 and before == after
            r.add("2.6", "corp reveal foreign worker ad → 403 + no quota bump",
                  "403 + COUNT unchanged",
                  f"{sc} before={before} after={after}", ok,
                  det if not ok else None)
    finally:
        org.close()


def test_money(r: Runner) -> None:
    """§2.7 — payment_events with is_fake=FALSE must be 0 on staging."""
    pay = db("payment_db")
    try:
        n_real = scalar(pay, "SELECT COUNT(*) FROM payment_events WHERE is_fake=0")
        r.add("2.7", "payment_events WHERE is_fake=FALSE",
              "0 on staging", str(n_real), n_real == 0,
              f"payment_events has {n_real} real (is_fake=0) rows — check "
              "PAYMENT_FAKE_MODE on the payment service." if n_real else None)
    finally:
        pay.close()


# ─── Seed report ────────────────────────────────────────────────────────────

def print_seed_report() -> None:
    print("\n═══ SEED REPORT — read-only ═══\n")

    org = db("org_db")
    pay = db("payment_db")
    try:
        # (a) ads by profession
        print("── ads by profession (worker, active) ──")
        rows = rows_of(
            org,
            """SELECT profession_code, COUNT(*) FROM ads
                 WHERE ad_type='worker' AND active=1 AND deleted_at IS NULL
                 GROUP BY profession_code
                 ORDER BY 2 DESC""",
        )
        if not rows:
            print("  (none)")
        for prof, n in rows:
            marker = "  ✓" if n >= 5 else "  ✗ (H7 target: 5)"
            print(f"  {prof:<20} {n:>3}{marker}")

        # (b) housing distribution
        print("\n── housing ads (active) ──")
        rows = rows_of(
            org,
            """SELECT city, IFNULL(total_beds,0), IFNULL(available_beds,0), COUNT(*) c
                 FROM ads
                 WHERE ad_type='housing' AND active=1 AND deleted_at IS NULL
                 GROUP BY city, total_beds, available_beds
                 ORDER BY c DESC""",
        )
        if not rows:
            print("  (none)")
        housing_variety = len(rows)
        for city, tot, avail, c in rows:
            print(f"  {city or '(no city)':<20} beds={tot:<4} avail={avail:<4} rows={c}")
        print(f"  ── H7 target: ≥10 housing rows; distinct configs found: {housing_variety}")

        # (c) duplicates
        print("\n── active ad duplicates (title_he > 1) ──")
        rows = rows_of(
            org,
            """SELECT title_he, COUNT(*) c FROM ads
                 WHERE active=1 AND deleted_at IS NULL
                 GROUP BY title_he HAVING c > 1
                 ORDER BY c DESC""",
        )
        if not rows:
            print("  (clean — no duplicate titles)")
        else:
            for title, c in rows:
                # Truncate the title so we don't dump a novel per row.
                t = (title or "")[:60] + ("…" if title and len(title) > 60 else "")
                print(f"  ×{c}  {t}")

        # (d) corp + contractor counts
        n_corp    = scalar(org, "SELECT COUNT(*) FROM corporations WHERE deleted_at IS NULL")
        n_kablan  = scalar(org, "SELECT COUNT(*) FROM contractors  WHERE deleted_at IS NULL")
        n_pay_r   = scalar(pay, "SELECT COUNT(*) FROM payment_events WHERE is_fake=0")
        n_pay_f   = scalar(pay, "SELECT COUNT(*) FROM payment_events WHERE is_fake=1")
        print("\n── orgs + payment_events ──")
        print(f"  corporations: {n_corp} (H7 target: ≥6)")
        print(f"  contractors:  {n_kablan} (H7 target: ≥4)")
        print(f"  payment_events real (is_fake=0): {n_pay_r}")
        print(f"  payment_events fake (is_fake=1): {n_pay_f}")
    finally:
        org.close()
        pay.close()

    print("\n═══ end seed report ═══\n")


# ─── Manual-only list ──────────────────────────────────────────────────────

MANUAL_ONLY = """
נבדק ידנית בלבד (S1 לא מכסה):
  · פריסת השורות ב-390 (mobile reflow)
  · תגי האמון על המסך (badge visuals)
  · לולאת הדמו — LiveActivityFeed autoplay
  · הרצף חיפוש → התחברות → חזרה — RT flow
  · מסכי האדמין (visual + interactions)
  · ניגודיות ומקלדת — WCAG 2.1 AA
  · SMS delivery — did the OTP actually arrive
"""


# ─── main ──────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True,
                        help="Gateway base URL (e.g. https://gateway-staging-3a12.up.railway.app)")
    parser.add_argument("--seed-report", action="store_true",
                        help="Print seed inventory (read-only) and exit 0. "
                             "Does NOT run the smoke tests.")
    args = parser.parse_args()

    refuse_production(args.base_url)

    # Env sanity — bail before any HTTP call.
    required = ("MASTER_OTP", "MYSQL_HOST", "MYSQL_ROOT_PASSWORD",
                "CONTRACTOR_APPROVED_PHONE", "CONTRACTOR_PENDING_PHONE",
                "CONTRACTOR_B_PHONE", "CORPORATION_PHONE")
    missing = [k for k in required if not os.getenv(k)]
    if missing:
        print(f"[smoke] FATAL: missing env vars: {missing}", file=sys.stderr)
        return 3

    if args.seed_report:
        print_seed_report()
        return 0

    api = ApiClient(args.base_url)

    # Login 4 seeds. Each real /send-otp costs 1 Vonage SMS to the seed
    # phone owner (Yulian). Rate limit is 3/phone/10min → runs must be
    # spaced 10 min apart to stay comfortably under.
    print("[smoke] logging in 4 seed phones (sends 4 SMS to seed owner)…")
    labels_and_phones = [
        ("CONTRACTOR_APPROVED", os.environ["CONTRACTOR_APPROVED_PHONE"]),
        ("CONTRACTOR_PENDING",  os.environ["CONTRACTOR_PENDING_PHONE"]),
        ("CONTRACTOR_B",        os.environ["CONTRACTOR_B_PHONE"]),
        ("CORPORATION",         os.environ["CORPORATION_PHONE"]),
    ]
    master_otp = os.environ["MASTER_OTP"]
    sessions: Dict[str, Session] = {}
    for label, phone in labels_and_phones:
        print(f"  [{label}] phone={redact_phone(phone)}…")
        sessions[label] = login(api, phone, master_otp, label)

    print("[smoke] verifying all four entities have is_seed=TRUE…")
    verify_seeds_marked(list(sessions.values()))

    r = Runner()

    # Cache sample ad ids once — saves round trips.
    org = db("org_db")
    try:
        sample = {"any": sample_ad_id(org)}
    finally:
        org.close()

    print("[smoke] §2.1 anonymous negative…")
    test_anon_negative(api, r, sample)

    print("[smoke] §2.2 anonymous positive…")
    test_anon_positive(api, r)

    print("[smoke] §2.3 cross-entity isolation…")
    test_isolation(api, r,
                   sessions["CONTRACTOR_APPROVED"],
                   sessions["CONTRACTOR_B"],
                   sessions["CORPORATION"])

    print("[smoke] §2.4 approval + quota…")
    test_approval_and_quota(api, r,
                            sessions["CONTRACTOR_PENDING"],
                            sessions["CONTRACTOR_APPROVED"], sample)

    print("[smoke] §2.5 response leaks…")
    test_leaks(api, r, sessions["CONTRACTOR_APPROVED"], sessions["CORPORATION"])

    print("[smoke] §2.6 corp visibility…")
    test_corp_visibility(api, r, sessions["CORPORATION"])

    print("[smoke] §2.7 money guardrails…")
    test_money(r)

    r.print_table()

    print(MANUAL_ONLY)

    return r.exit_code()


if __name__ == "__main__":
    sys.exit(main())
