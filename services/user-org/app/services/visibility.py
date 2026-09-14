"""U3 · centralised visibility rules for the ads surface.

Five entry points read from the `ads` table:

  1. POST /search                         (routes/search.py)
  2. GET  /ads/{id}/contact-reveal        (routes/ads.py)
  3. GET  /ads/public/{ad_id}             (routes/ads.py)
  4. GET  /ads/public/recent              (routes/ads.py)
  5. GET  /ads/public/featured            (routes/ads.py)

Two rules apply to all of them:

  H12 · corporations see only their own worker inventory. A rival
        corp must NOT be able to enumerate worker ads via any of the
        five paths. Housing stays shared for everyone. Contractors +
        anonymous callers + admins see the full worker catalogue.

  L2  · pending / rejected / suspended contractors do not get full
        ad content. Approved contractors, corps, anon, and admin all
        pass. Enforced by returning 403 with the same code the reveal
        endpoint already uses (`entity_not_approved` / `_rejected` /
        `_suspended`) so the frontend's existing error mapping picks
        it up unchanged (services/frontend/src/lib/api/errors.ts:75).

These two helpers are the single source of truth. If the rule shifts,
edit here and every entry point picks it up. Do NOT inline the rule
at a call site — S1 + S2 found 5 separate H12 leaks caused by exactly
that (the rule lived in one place and a new entry-point forgot it).

`GET /ads/public/sponsored` is intentionally excluded — it reads a
different table (`sponsor_ads`) that is public by design (paid brand
banners). Do not add these guards there.
"""
from typing import List, Optional, Tuple

from fastapi import HTTPException

from app.db import get_db


def viewer_scope_wheres(
    x_entity_id: Optional[str],
    x_entity_type: Optional[str],
) -> Tuple[List[str], List[object]]:
    """H12 · SQL WHERE fragments + params to AND into any `ads` query.

    Contract:
      corporation caller       →  ["(a.ad_type <> 'worker' OR a.owner_entity_id = %s)"], [id]
      service_provider caller  →  ["1=0"], []          (U7 §3 · zero ads visible)
      contractor / anon / admin →  ([], [])

    The predicate is deliberately worded so housing rows pass
    unconditionally (a.ad_type='housing' → left side true → row kept)
    and worker rows only pass when owned by the caller. This is the
    ONE place the H12 rule lives; if you find yourself writing it
    inline anywhere else, stop and import from here instead.

    U7 §3 · service_provider is a third entity type that publishes
    on `marketplace_listings` only. It has no worker ads, no housing
    ads of its own, and MUST NOT see other entities' ads at all —
    a provider is a service seller; letting one enumerate corp
    workers or contractor housing would defeat the whole point of
    the visibility gate for a caller who signed up with zero
    registry verification. So we hand back the always-false clause
    for provider callers rather than an unbounded scope.

    The `a.` alias is required — every caller uses `FROM ads a`. If a
    caller uses a different alias, rename in the SQL layer (do NOT
    fork this helper).
    """
    if x_entity_type == "corporation" and x_entity_id:
        return (
            ["(a.ad_type <> 'worker' OR a.owner_entity_id = %s)"],
            [x_entity_id],
        )
    if x_entity_type == "service_provider":
        # 1=0 is deliberate: an unbounded LIMIT still executes but
        # returns 0 rows, which is exactly the shape /search and the
        # public feeds expect. Callers that route around the SQL and
        # do their own list build (only ads.py:1052 today) should
        # ALSO call require_no_service_provider() as a belt-and-braces
        # check — see below.
        return (["1=0"], [])
    return ([], [])


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
    which returns an empty ads scope. Calling both is the intended
    defense: gate rejects, scope backstops.
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
    /search or /public/{id} directly.

    Callers that don't want the DB round-trip on every request can
    cache the approval status per session on the frontend — but the
    server MUST re-check, because approval can be revoked mid-session
    and the frontend cache would then leak content the server should
    have blocked.

    Non-contractor callers (corp, admin, anonymous) pass unconditionally.
    """
    if x_entity_type != "contractor" or not x_entity_id:
        return

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
        # Header points at a non-existent contractor id — treat as
        # not-approved so a bogus header can't slip past. Same 404-vs-403
        # opacity rule the reveal endpoint uses (don't leak existence).
        raise HTTPException(status_code=403, detail={"code": "entity_not_approved"})

    # user-org's pymysql cursor is DictCursor by default; support tuple
    # too so a future connection refactor doesn't silently regress.
    status = row["approval_status"] if isinstance(row, dict) else row[0]
    if status != "approved":
        code = {
            "pending":   "entity_not_approved",
            "rejected":  "entity_rejected",
            "suspended": "entity_suspended",
        }.get(status, "entity_not_approved")
        raise HTTPException(status_code=403, detail={"code": code, "status": status})
