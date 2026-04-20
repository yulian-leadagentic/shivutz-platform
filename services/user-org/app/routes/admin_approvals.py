from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.db import get_db
from app.publisher import publish_event

router = APIRouter()


class ApprovalDecision(BaseModel):
    approved: bool
    reason: Optional[str] = None
    admin_user_id: str


@router.get("/pending-approvals")
def list_pending():
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, company_name, contact_email, approval_sla_deadline, created_at, 'contractor' AS org_type FROM contractors WHERE approval_status='pending' AND deleted_at IS NULL"
            " UNION ALL "
            "SELECT id, company_name, contact_email, approval_sla_deadline, created_at, 'corporation' AS org_type FROM corporations WHERE approval_status='pending' AND deleted_at IS NULL"
            " ORDER BY approval_sla_deadline ASC"
        )
        return cur.fetchall()
    finally:
        conn.close()


@router.patch("/approvals/{org_id}")
async def decide(org_id: str, body: ApprovalDecision, org_type: str = "contractor"):
    status = "approved" if body.approved else "rejected"
    conn = get_db()
    try:
        cur = conn.cursor()
        table = "contractors" if org_type == "contractor" else "corporations"

        cur.execute(
            f"UPDATE {table} SET approval_status=%s, approved_by_user_id=%s, approved_at=NOW(), rejection_reason=%s WHERE id=%s",
            (status, body.admin_user_id, body.reason, org_id)
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Organization not found")
        conn.commit()

        cur.execute(f"SELECT company_name, contact_email, contact_name, contact_phone FROM {table} WHERE id=%s", (org_id,))
        org = cur.fetchone()

        event_key = "org.approved" if body.approved else "org.rejected"
        await publish_event(event_key, {
            "org_id":        org_id,
            "org_type":      org_type,
            "org_name":      org["company_name"],
            "contact_email": org["contact_email"],
            "contact_name":  org["contact_name"],
            "contact_phone": org.get("contact_phone") or "",
            "reason":        body.reason or "",
        })

        return {"id": org_id, "status": status}
    finally:
        conn.close()
