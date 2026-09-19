"""U3 · centralised visibility rules for the ads surface.

Five entry points read from the `ads` table:

  1. POST /search                         (routes/search.py)
  2. GET  /ads/{id}/contact-reveal        (routes/ads.py)
  3. GET  /ads/public/{ad_id}             (routes/ads.py)
  4. GET  /ads/public/recent              (routes/ads.py)
  5. GET  /ads/public/featured            (routes/ads.py)

R12 · 2026-09-19 policy correction (Yulian).

  Search is OPEN. Every caller — anonymous, contractor, corp,
  service_provider, admin — sees the full worker + housing catalogue
  on all read paths above. The earlier H12 rule ("corporations see
  only their own worker inventory · service_provider gets 1=0") was
  a misreading; the ONLY per-role restriction the product intends is
  on **revealing contact details** of corp-owned worker ads, which
  is contractors-only and is enforced independently on the reveal
  endpoint itself (ads.py:@router.get("/{ad_id}/contact-reveal"),
  where require_no_service_provider + require_contractor_approved +
  subscription/tier gates already live).

  `viewer_scope_wheres` therefore returns an empty scope for every
  caller. The function is kept (rather than deleted at every call
  site) as the single reversal point should the rule ever change
  again — one edit here reintroduces per-role scoping across all
  five read paths at once, and every existing caller passes
  (x_entity_id, x_entity_type) headers so the signature stays useful.

  L2  · pending / rejected / suspended contractors do not get full
        ad content. Enforced by `require_contractor_approved` below,
        returning 403 with the code the reveal endpoint already uses
        (`entity_not_approved` / `_rejected` / `_suspended`) so the
        frontend's existing error mapping picks it up unchanged
        (services/frontend/src/lib/api/errors.ts:75).

`GET /ads/public/sponsored` is intentionally excluded — it reads a
different table (`sponsor_ads`) that is public by design (paid brand
banners). Do not add these guards there.
"""
from typing import List, Optional, Tuple

from fastapi import HTTPException

from app.db import get_db


def viewer_scope_wheres(
    x_entity_id: Optional[str],  # noqa: ARG001 · kept for the reversal-point contract
    x_entity_type: Optional[str],  # noqa: ARG001
) -> Tuple[List[str], List[object]]:
    """R12 · no-op after the search-open policy correction.

    Contract: returns `([], [])` for every caller — anon, contractor,
    corp, service_provider, admin — so all five ads read paths (search
    + 4 public feeds + the direct-fetch endpoint) render the full
    catalogue.

    The function stays as the single reversal point (see module
    docstring). Do NOT re-add per-role WHERE fragments at call sites;
    edit here so the rule change is visible across all five paths at
    once. `require_no_service_provider` still gates non-search
    endpoints where a provider legitimately doesn't belong; that's
    orthogonal to the read-visibility question this helper answers.
    """
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
