"""Admin-only proxy for the notification service's internal /test/* endpoints.

The notification service exposes:
  GET  /internal/test/catalog
  POST /internal/test/event
  POST /internal/test/cron/{name}

Those endpoints have no auth (Docker-internal). We re-expose them under
/admin/notifications/test/* so the gateway's admin-only check at /api/admin
gates access. Anything we'd want to add (audit logging, rate limits, allow
list) goes here, not on the notification side.
"""
import os
from typing import Any, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

NOTIF_URL = os.getenv("NOTIFICATION_SERVICE_URL", "http://notification:3006")


class TriggerEventBody(BaseModel):
    event_type:     str
    payload:        Optional[dict[str, Any]] = None
    override_phone: Optional[str] = None
    override_email: Optional[str] = None


@router.get("/notifications/test/catalog")
async def get_catalog():
    """Return the event + cron list the test panel renders."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{NOTIF_URL}/internal/test/catalog")
            r.raise_for_status()
            return r.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"notification_service_unreachable: {e}")


@router.post("/notifications/test/event")
async def fire_event(body: TriggerEventBody):
    """Fire an arbitrary notification event with the supplied payload.

    The admin's chosen override_phone / override_email replace every
    recipient field for that event so a test send never reaches a real user.
    """
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                f"{NOTIF_URL}/internal/test/event",
                json=body.model_dump(exclude_none=True),
            )
            data = r.json()
            if r.status_code >= 400:
                raise HTTPException(status_code=r.status_code, detail=data.get("error", "trigger_failed"))
            return data
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"notification_service_unreachable: {e}")


class SendMessageBody(BaseModel):
    phone:   str
    message: str
    # Optional context — surfaces in the audit log so we can see why an
    # admin reached out. Not part of the SMS body.
    org_id:        Optional[str] = None
    org_type:      Optional[str] = None
    corp_deal_no:  Optional[int] = None


@router.post("/notifications/send-message")
async def send_admin_message(body: SendMessageBody):
    """Admin-initiated outreach to a corporation or contractor contact.

    Used from /admin/orgs/{id} when the admin wants to reach the corp
    about a specific deal — e.g. "your corp-deal #C-127 is stuck,
    please respond". The corp_deal_no is just an audit-log marker;
    the actual SMS body the admin typed is sent verbatim.
    """
    if not body.phone or not body.phone.strip():
        raise HTTPException(status_code=400, detail="phone_required")
    if not body.message or not body.message.strip():
        raise HTTPException(status_code=400, detail="message_required")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                f"{NOTIF_URL}/internal/sms",
                json={"phone": body.phone.strip(), "message": body.message.strip()},
            )
            data = r.json()
            if r.status_code >= 400:
                raise HTTPException(status_code=r.status_code, detail=data.get("error", "send_failed"))
            return data
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"notification_service_unreachable: {e}")


@router.post("/notifications/test/cron/{name}")
async def fire_cron(name: str):
    """Run one of the 5 cron jobs once with the current DB state."""
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            r = await client.post(f"{NOTIF_URL}/internal/test/cron/{name}")
            data = r.json()
            if r.status_code >= 400:
                raise HTTPException(status_code=r.status_code, detail=data.get("error", "cron_failed"))
            return data
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"notification_service_unreachable: {e}")
