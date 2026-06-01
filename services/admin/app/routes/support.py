"""Admin inbox for customer-service tickets (QA-R3 #24).

Reads the support_tickets table in org_db. Listing + status transitions
+ admin notes. New tickets land via user-org's POST /support-tickets;
the table itself is created by migration 036.
"""
from typing import Optional
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel

from app.db import get_db

router = APIRouter()


class TicketUpdate(BaseModel):
    status: Optional[str] = None         # 'open' | 'in_progress' | 'resolved'
    admin_notes: Optional[str] = None


# Light enrichment — pull the org's display name when the ticket is
# attached to one, plus the submitter's phone if we have it on the
# auth_db.users row, so the admin can call them back without
# clicking through to the org detail page.
def _enrich_ticket(conn, t: dict) -> dict:
    if t.get("entity_type") == "contractor" and t.get("entity_id"):
        cur = conn.cursor()
        cur.execute(
            "SELECT company_name, company_name_he, contact_phone, contact_email "
            "FROM org_db.contractors WHERE id=%s",
            (t["entity_id"],),
        )
        row = cur.fetchone()
        if row:
            t["org_name"] = row.get("company_name_he") or row.get("company_name")
            t["org_phone"] = row.get("contact_phone")
            t["org_email"] = row.get("contact_email")
    elif t.get("entity_type") == "corporation" and t.get("entity_id"):
        cur = conn.cursor()
        cur.execute(
            "SELECT company_name, company_name_he, contact_phone, contact_email "
            "FROM org_db.corporations WHERE id=%s",
            (t["entity_id"],),
        )
        row = cur.fetchone()
        if row:
            t["org_name"] = row.get("company_name_he") or row.get("company_name")
            t["org_phone"] = row.get("contact_phone")
            t["org_email"] = row.get("contact_email")

    if t.get("user_id"):
        cur = conn.cursor()
        cur.execute("SELECT phone, full_name FROM auth_db.users WHERE id=%s", (t["user_id"],))
        row = cur.fetchone()
        if row:
            t["user_phone"] = row.get("phone")
            t["user_name"]  = row.get("full_name")

    # MySQL datetime → ISO so the frontend can format consistently.
    for k in ("created_at", "handled_at"):
        v = t.get(k)
        if v is not None and hasattr(v, "isoformat"):
            t[k] = v.isoformat()
    return t


@router.get("")
def list_tickets(status: Optional[str] = None):
    """List support tickets, newest first. Optional ?status=open|in_progress|resolved."""
    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        if status and status in ("open", "in_progress", "resolved"):
            cur.execute(
                "SELECT * FROM support_tickets WHERE status=%s ORDER BY created_at DESC",
                (status,),
            )
        else:
            cur.execute("SELECT * FROM support_tickets ORDER BY created_at DESC")
        rows = cur.fetchall()
        return [_enrich_ticket(conn, dict(r)) for r in rows]
    finally:
        conn.close()


@router.patch("/{ticket_id}")
def update_ticket(
    ticket_id: str,
    data: TicketUpdate,
    x_user_id: Optional[str] = Header(default=None),
):
    fields: list[str] = []
    params: list = []
    if data.status is not None:
        if data.status not in ("open", "in_progress", "resolved"):
            raise HTTPException(status_code=400, detail="invalid_status")
        fields.append("status=%s")
        params.append(data.status)
        # Stamp handled_at + handled_by when moving to resolved; clear if
        # admin re-opens (so the audit row reflects the *latest* close).
        if data.status == "resolved":
            fields.append("handled_at=NOW()")
            fields.append("handled_by_user_id=%s")
            params.append(x_user_id)
        elif data.status == "open":
            fields.append("handled_at=NULL")
            fields.append("handled_by_user_id=NULL")
    if data.admin_notes is not None:
        fields.append("admin_notes=%s")
        params.append(data.admin_notes.strip() or None)
    if not fields:
        raise HTTPException(status_code=400, detail="no_fields_to_update")
    params.append(ticket_id)

    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        cur.execute(f"UPDATE support_tickets SET {', '.join(fields)} WHERE id=%s", tuple(params))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="ticket_not_found")
        conn.commit()
        return {"id": ticket_id}
    finally:
        conn.close()
