"""Customer-service ticket submission endpoint (QA-R3 #24).

Anyone logged in — contractor, corporation, admin — can POST a ticket
from the in-app "פניה לשירות לקוחות" form. Tickets land in org_db's
support_tickets table with the entity context they were submitted from.
Admins view + handle the inbox via the admin service's /admin/support
endpoints.
"""
import uuid
from typing import Optional
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, Field

from app.db import get_db

router = APIRouter()


class TicketCreate(BaseModel):
    subject: str = Field(min_length=2, max_length=200)
    body: str = Field(min_length=2)
    # Optional callback phone if the user wants to be reached on a number
    # other than the one they signed up with.
    contact_phone: Optional[str] = None


@router.post("", status_code=201)
def submit_ticket(
    data: TicketCreate,
    x_user_id: Optional[str] = Header(default=None),
    x_org_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    # Gateway only ever proxies this route when auth has already
    # validated, so x_user_id should be present. Belt-and-braces 401.
    if not x_user_id:
        raise HTTPException(status_code=401, detail="unauthorized")

    # entity_type mirrors the JWT entity context, falling back to the
    # legacy role when no entity is attached (admins).
    entity_type = x_user_role if x_user_role in ("contractor", "corporation", "admin") else None
    entity_id   = x_org_id if entity_type in ("contractor", "corporation") else None

    ticket_id = str(uuid.uuid4())
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO support_tickets
               (id, entity_type, entity_id, user_id, subject, body, contact_phone, status)
               VALUES (%s,%s,%s,%s,%s,%s,%s,'open')""",
            (ticket_id, entity_type, entity_id, x_user_id,
             data.subject.strip(), data.body.strip(),
             (data.contact_phone or "").strip() or None)
        )
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()
    return {"id": ticket_id, "status": "open"}
