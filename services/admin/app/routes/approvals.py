from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from typing import Optional
import os, httpx

from app.db import get_db

router = APIRouter()

USER_ORG_URL = os.getenv("USER_ORG_SERVICE_URL", "http://user-org:3002")


@router.get("/pending-approvals")
def list_pending():
    conn = get_db("org_db")
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute(
            """
            SELECT id, company_name, COALESCE(company_name_he,'') AS company_name_he,
                   contact_email, contact_name, contact_phone, business_number,
                   approval_sla_deadline, created_at, 'contractor' AS org_type
            FROM contractors
            WHERE approval_status='pending' AND deleted_at IS NULL
            UNION ALL
            SELECT id, company_name, COALESCE(company_name_he,'') AS company_name_he,
                   contact_email, contact_name, contact_phone, business_number,
                   approval_sla_deadline, created_at, 'corporation' AS org_type
            FROM corporations
            WHERE approval_status='pending' AND deleted_at IS NULL
            ORDER BY approval_sla_deadline ASC
            """
        )
        rows = cur.fetchall()
        for r in rows:
            for k, v in r.items():
                if hasattr(v, 'isoformat'):
                    r[k] = v.isoformat()
        return rows
    finally:
        conn.close()


@router.get("/orgs/{org_id}")
def get_org(org_id: str, org_type: str = "contractor"):
    conn = get_db("org_db")
    try:
        cur = conn.cursor(dictionary=True)
        table = "contractors" if org_type == "contractor" else "corporations"
        cur.execute(f"SELECT * FROM {table} WHERE id=%s AND deleted_at IS NULL", (org_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Organisation not found")
        for k, v in row.items():
            if hasattr(v, 'isoformat'):
                row[k] = v.isoformat()
        return {**row, "org_type": org_type}
    finally:
        conn.close()


@router.get("/approved-orgs")
def list_approved():
    conn = get_db("org_db")
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute(
            """
            SELECT id, company_name, COALESCE(company_name_he,'') AS company_name_he,
                   contact_email, approval_status, created_at, 'contractor' AS org_type
            FROM contractors WHERE deleted_at IS NULL
            UNION ALL
            SELECT id, company_name, COALESCE(company_name_he,'') AS company_name_he,
                   contact_email, approval_status, created_at, 'corporation' AS org_type
            FROM corporations WHERE deleted_at IS NULL
            ORDER BY created_at DESC LIMIT 200
            """
        )
        rows = cur.fetchall()
        for r in rows:
            for k, v in r.items():
                if hasattr(v, 'isoformat'):
                    r[k] = v.isoformat()
        return rows
    finally:
        conn.close()


class ApprovalDecision(BaseModel):
    approved: bool
    reason: Optional[str] = None


@router.patch("/approvals/{org_id}")
async def decide(
    org_id: str,
    body: ApprovalDecision,
    org_type: str = "contractor",
    x_user_id: Optional[str] = Header(default=None),
):
    admin_user_id = x_user_id or "admin"
    status = "approved" if body.approved else "rejected"
    conn = get_db("org_db")
    try:
        cur = conn.cursor(dictionary=True)
        table = "contractors" if org_type == "contractor" else "corporations"

        cur.execute(
            f"""UPDATE {table}
                SET approval_status=%s, approved_by_user_id=%s,
                    approved_at=NOW(), rejection_reason=%s
                WHERE id=%s AND deleted_at IS NULL""",
            (status, admin_user_id, body.reason, org_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Organisation not found")
        conn.commit()

        cur.execute(
            f"SELECT company_name, contact_email, contact_name FROM {table} WHERE id=%s",
            (org_id,),
        )
        org = cur.fetchone()

        # Best-effort: fire event via user-org which has the RabbitMQ publisher
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                await client.patch(
                    f"{USER_ORG_URL}/admin/approvals/{org_id}",
                    params={"org_type": org_type},
                    json={
                        "approved": body.approved,
                        "reason": body.reason or "",
                        "admin_user_id": admin_user_id,
                    },
                )
        except Exception:
            pass

        return {
            "id": org_id,
            "org_type": org_type,
            "status": status,
            "company_name": org["company_name"] if org else "",
        }
    finally:
        conn.close()
