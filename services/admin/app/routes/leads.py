"""Admin endpoint for the 'leave-details' / callback queue.

Public visitors fill the lead form on the landing page; rows land in
`org_db.leads`. Admin needs to see them, mark them contacted, and remove
once handled.
"""
from typing import Optional

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel

from app.db import get_db

router = APIRouter()


def _serialize(row: dict) -> dict:
    for k, v in list(row.items()):
        if hasattr(v, "isoformat"):
            row[k] = v.isoformat()
    return row


@router.get("/leads")
def list_leads(handled: Optional[str] = None):
    """All callback requests, newest first.

    `handled=true` → only handled rows
    `handled=false` (default) → only pending rows
    `handled=all` → both
    """
    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        where = ""
        if handled == "true":
            where = "WHERE handled_at IS NOT NULL"
        elif handled == "all":
            where = ""
        else:  # default = pending
            where = "WHERE handled_at IS NULL"
        cur.execute(
            f"""SELECT id, full_name, phone, org_type, source, notes,
                       handled_at, handled_by_user_id, created_at
                FROM leads
                {where}
                ORDER BY created_at DESC LIMIT 500"""
        )
        return [_serialize(r) for r in cur.fetchall()]
    finally:
        conn.close()


@router.patch("/leads/{lead_id}/handled", status_code=204)
def mark_handled(lead_id: str, x_user_id: Optional[str] = Header(default=None)):
    """Mark a lead as handled (contacted). Idempotent — marking twice is a no-op."""
    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE leads SET handled_at=NOW(), handled_by_user_id=%s WHERE id=%s AND handled_at IS NULL",
            (x_user_id or "admin", lead_id),
        )
        conn.commit()
    finally:
        conn.close()


@router.patch("/leads/{lead_id}/reopen", status_code=204)
def reopen_lead(lead_id: str):
    """Reopen a lead — handy when a callback didn't actually happen."""
    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE leads SET handled_at=NULL, handled_by_user_id=NULL WHERE id=%s",
            (lead_id,),
        )
        conn.commit()
    finally:
        conn.close()


@router.delete("/leads/{lead_id}", status_code=204)
def delete_lead(lead_id: str):
    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM leads WHERE id=%s", (lead_id,))
        conn.commit()
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="lead_not_found")
    finally:
        conn.close()


# ── Refund-request notification (called by corp billing page) ───────────────

class RefundRequestIn(BaseModel):
    deal_id: str
    reason: str


@router.post("/refund-requests", status_code=201)
def submit_refund_request(body: RefundRequestIn, x_user_id: Optional[str] = Header(default=None)):
    """Stores a refund request as a `lead` row of source='refund_request' so
    admin sees it in the same queue. Avoids new infrastructure for this
    one-off action while keeping it auditable."""
    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id FROM leads WHERE source=%s AND notes LIKE %s LIMIT 1",
            ("refund_request", f"%{body.deal_id}%"),
        )
        if cur.fetchone():
            return {"ok": True, "duplicate": True}

        notes = f"Refund request for deal {body.deal_id}\nReason: {body.reason}\nRequested by user: {x_user_id or 'unknown'}"
        cur.execute(
            """INSERT INTO leads (full_name, phone, org_type, source, notes)
               VALUES (%s, %s, 'corporation', 'refund_request', %s)""",
            (f"החזר עבור {body.deal_id[:8]}", x_user_id or 'unknown', notes),
        )
        conn.commit()
        return {"ok": True, "duplicate": False}
    finally:
        conn.close()
