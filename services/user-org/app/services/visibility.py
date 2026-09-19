"""U3 · centralised visibility rules for the ads surface.

Five entry points read from the `ads` table:

  1. POST /search                         (routes/search.py)
  2. GET  /ads/{id}/contact-reveal        (routes/ads.py)
  3. GET  /ads/public/{ad_id}             (routes/ads.py)
  4. GET  /ads/public/recent              (routes/ads.py)
  5. GET  /ads/public/featured            (routes/ads.py)

R13 · 2026-09-19 · Yulian's confirmed visibility matrix on `ads` rows
(marketplace_listings runs on its own rules, no scope):

  Caller             worker ads   housing ads   why
  -----------------  -----------  ------------  --------------------------------
  anonymous          ✗            ✗             worker + housing require login
  contractor OK      ✓ all        ✓             primary buyer persona
  contractor pending ✗            ✗             scope is applied in search.py
  corporation        own only     ✓             H12 anti-enumeration re-affirmed
  service_provider   ✗            ✓             sells alongside housing
  admin              ✓            ✓             admin-role bypass

`viewer_scope_wheres` encodes rows 1, 3-6. Contractor `pending` is not
inside this helper — search.py runs `contractor_approval_status` and
appends its own `1=0` fragment, because approval status is a live DB
column and turning this helper into a query-runner would ripple to
the four other callers that don't need it.

Only per-role rule the product intends is on ads visibility here, and
on contact-reveal (contractors only) — both enforced elsewhere; do not
inline the reveal check.

`GET /ads/public/sponsored` is intentionally excluded — it reads a
different table (`sponsor_ads`) that is public by design (paid brand
banners). Do not add these guards there.
"""
from typing import List, Optional, Tuple

from fastapi import HTTPException

from app.db import get_db


def viewer_scope_wheres(
    x_entity_id:   Optional[str],
    x_entity_type: Optional[str],
    x_user_role:   Optional[str] = None,
) -> Tuple[List[str], List[object]]:
    """R13 §2a · SQL WHERE fragments to AND into any `FROM ads a` query.

    Contract:
      admin (any x_user_role='admin')  →  ([], [])
      contractor OR contractor pending →  ([], [])         · search.py scopes pending
      corporation                      →  (["(a.ad_type <> 'worker' OR a.owner_entity_id = %s)"], [id])
      service_provider                 →  (["a.ad_type <> 'worker'"], [])
      anonymous (no user role at all)  →  (["1=0"], [])

    Why `x_user_role` as a THIRD arg: an admin picks the `מנהל מערכת`
    row at /select-entity and lands with no entity context — the JWT
    then has `role='admin'` but no `entity_type`. Without this signal
    the admin would fall into the anonymous branch and get `1=0`.
    The gateway already projects `entity_type || role` into
    `x-user-role` (see gateway/src/index.js:305), so search.py + the
    three public feeds pass it straight through.

    The `a.` alias is required — every caller uses `FROM ads a`. If a
    caller uses a different alias, rename in the SQL layer (do NOT
    fork this helper).
    """
    if x_user_role == "admin":
        return ([], [])
    if x_entity_type == "corporation" and x_entity_id:
        return (
            ["(a.ad_type <> 'worker' OR a.owner_entity_id = %s)"],
            [x_entity_id],
        )
    if x_entity_type == "service_provider":
        return (["a.ad_type <> 'worker'"], [])
    if x_entity_type == "contractor":
        # Approval status is handled in search.py — a pending contractor
        # gets a `1=0` appended by the caller so this helper stays
        # DB-free and the pending scope is a one-line append at the
        # single caller that needs it (search).
        return ([], [])
    # No entity_type + not admin → anonymous. Block ads reads; the
    # marketplace pass in search.py runs regardless (no scope arg
    # goes to _search_marketplace), so anon still sees services.
    return (["1=0"], [])


def contractor_approval_status(x_entity_id: str) -> Optional[str]:
    """R13 §2d · one live status read for a contractor caller.

    Returns the `contractors.approval_status` value ('approved',
    'pending', 'rejected', 'suspended') or None when the row is
    missing (deleted mid-session, or the header points at a bogus
    id — same 404-vs-403 opacity the reveal endpoint uses).

    Only search.py uses this. The other four ads read paths still
    call `require_contractor_approved` and 403 on a pending caller,
    per §3 guardrail ("`require_contractor_approved` נשאר בכל שאר
    הנתיבים").
    """
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT approval_status FROM contractors WHERE id=%s AND deleted_at IS NULL",
            (x_entity_id,),
        )
        row = cur.fetchone()
    finally:
        conn.close()
    if not row:
        return None
    return row["approval_status"] if isinstance(row, dict) else row[0]


def require_no_service_provider(x_entity_type: Optional[str]) -> None:
    """U7 §3 · 403 for service_provider callers on paths not meant
    for them.

    Call at the TOP of any endpoint whose response is for
    contractors or corporations only:
      * POST /reveals              (worker/housing contact reveal)
      * /corporation/*             (management screens for corp)
      * /contractor/*              (management screens for contractor)
      * /tenders/*                 (foreign-worker tenders)

    Do NOT call for endpoints a provider legitimately uses:
      * GET /marketplace           (their own domain)
      * GET /how-it-works, legal   (public regardless)

    This helper is NOT a full visibility layer — a service provider
    who slips past it still runs into viewer_scope_wheres above
    which returns `a.ad_type <> 'worker'` (housing-only) for their
    ads reads. Calling both is the intended defense: gate rejects
    on write/reveal paths, scope backstops on read paths.
    """
    if x_entity_type == "service_provider":
        raise HTTPException(status_code=403, detail={"code": "entity_type_forbidden"})


def require_contractor_approved(
    x_entity_id: Optional[str],
    x_entity_type: Optional[str],
) -> None:
    """L2 · raise 403 for a non-approved contractor. Pass otherwise.

    Called at the TOP of any query endpoint that returns full ad
    content. Mirrors the reveal-endpoint gate at ads.py:989-1014 so
    a pending contractor can't sidestep the approval flow by hitting
    /public/{id} directly. R13 §2d removed this from /search only
    (pending contractors get a scoped 200 there); every OTHER read
    path still 403s on pending — see the guardrails.

    Callers that don't want the DB round-trip on every request can
    cache the approval status per session on the frontend — but the
    server MUST re-check, because approval can be revoked mid-session
    and the frontend cache would then leak content the server should
    have blocked.

    Non-contractor callers (corp, admin, anonymous) pass unconditionally.
    """
    if x_entity_type != "contractor" or not x_entity_id:
        return

    status = contractor_approval_status(x_entity_id)
    if status is None:
        # Contractor was hard-deleted mid-session, or the header
        # points at a non-existent id. Same 404-vs-403 opacity rule
        # the reveal endpoint uses (don't leak existence).
        raise HTTPException(status_code=403, detail={"code": "entity_not_approved"})

    if status != "approved":
        code = {
            "pending":   "entity_not_approved",
            "rejected":  "entity_rejected",
            "suspended": "entity_suspended",
        }.get(status, "entity_not_approved")
        raise HTTPException(status_code=403, detail={"code": code, "status": status})
