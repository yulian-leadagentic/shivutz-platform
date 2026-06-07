"""Membership-request endpoints — owner side of the inverted-invite flow.

When a new user tries to register a corp/contractor whose ח.פ already
has an active org, the registration endpoint creates a
membership_request row and SMS'es the existing owner. The owner clicks
the magic link → lands on /membership-request/accept/{token} on the
frontend → that page calls:

  GET  /membership-requests/{token}         — fetch request + entity context
  POST /membership-requests/{token}/approve — owner says yes, requester is added
  POST /membership-requests/{token}/reject  — owner says no, requester SMS'd

Gateway routes /api/membership-requests/* to user-org (added separately).
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Body, Header, HTTPException

from app.publisher import publish_event
from app.services import membership_requests as mreq

router = APIRouter()


@router.get("/membership-requests/{token}")
def get_request(token: str):
    """Public — the magic-link page fetches the request before auth.
    Returns enough context for the page to render ('approve [name] to
    join [entity]') without leaking sensitive fields."""
    row = mreq.get_by_token(token)
    if not row:
        raise HTTPException(status_code=404, detail="request_not_found")
    # Slim the payload — don't expose approved_by, internal IDs, etc.
    return {
        "id":              row["id"],
        "status":          row["status"],
        "entity_type":     row["entity_type"],
        "entity_id":       row["entity_id"],
        "entity_name":     row.get("entity_name"),
        "requester_name":  row["requester_name"],
        "requester_phone": row["requester_phone"],
        "requested_role":  row["requested_role"],
        "expires_at":      row["expires_at"],
        "created_at":      row["created_at"],
    }


@router.post("/membership-requests/{token}/approve")
async def approve_request(
    token: str,
    x_user_id: Optional[str] = Header(default=None),
):
    """Owner approves — creates the team-member row and SMS's the
    requester. Auth: caller must be an owner of the target entity
    (enforced inside the service layer)."""
    if not x_user_id:
        raise HTTPException(status_code=401, detail="auth_required")
    result = mreq.approve(token, x_user_id)
    if not result.get("ok"):
        err = result.get("error", "approve_failed")
        if err == "not_authorized":
            raise HTTPException(status_code=403, detail="not_authorized")
        if err == "request_not_found":
            raise HTTPException(status_code=404, detail="request_not_found")
        raise HTTPException(status_code=400, detail=err)

    # Fire 'approved' SMS to the requester so they know they're in.
    await publish_event("team.membership_request.approved", {
        "requester_phone": result["requester_phone"],
        "requester_name":  result["requester_name"],
        "entity_type":     result["entity_type"],
    })
    return {
        "ok": True,
        "membership_id": result["membership_id"],
    }


@router.post("/membership-requests/{token}/reject")
async def reject_request(
    token: str,
    payload: dict = Body(default={}),
    x_user_id: Optional[str] = Header(default=None),
):
    if not x_user_id:
        raise HTTPException(status_code=401, detail="auth_required")
    reason = (payload or {}).get("reason")
    result = mreq.reject(token, x_user_id, reason)
    if not result.get("ok"):
        err = result.get("error", "reject_failed")
        if err == "not_authorized":
            raise HTTPException(status_code=403, detail="not_authorized")
        if err == "request_not_found":
            raise HTTPException(status_code=404, detail="request_not_found")
        raise HTTPException(status_code=400, detail=err)
    # Notify requester they were rejected — keeps them from waiting.
    await publish_event("team.membership_request.rejected", {
        "requester_phone": result["requester_phone"],
        "requester_name":  result["requester_name"],
        "entity_type":     result["entity_type"],
        "reason":          reason or "",
    })
    return {"ok": True}
