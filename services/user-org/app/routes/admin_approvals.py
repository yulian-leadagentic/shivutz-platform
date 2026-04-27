from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.db import get_db
from app.publisher import publish_event
from app.integrations import data_gov_il

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


@router.post("/contractors/revalidate")
async def revalidate_tier_2_contractors():
    """Re-check all tier_2 contractors that were verified via the registry
    (email/sms) against the live פנקס הקבלנים. Manual approvals are skipped
    — they didn't depend on registry presence.

    Demote to tier_1 if the contractor is no longer in the pinkash dataset
    (license revoked, suspended, or removed) and notify them so they can
    re-verify. Called from the notification-service cron daily.
    """
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT id, business_number, contact_email, contact_phone, contact_name, company_name_he
               FROM contractors
               WHERE verification_tier = 'tier_2'
                 AND verification_method IN ('email','sms')
                 AND revalidate_at <= NOW()
                 AND deleted_at IS NULL"""
        )
        candidates = cur.fetchall()
    finally:
        conn.close()

    checked = 0
    revalidated = 0
    demoted = 0
    for c in candidates:
        checked += 1
        result = await data_gov_il.lookup(c["business_number"])
        conn = get_db()
        try:
            cur = conn.cursor()
            if result["pinkash_found"]:
                cur.execute(
                    """UPDATE contractors
                       SET revalidate_at = DATE_ADD(NOW(), INTERVAL 183 DAY)
                       WHERE id = %s""",
                    (c["id"],),
                )
                conn.commit()
                revalidated += 1
            else:
                cur.execute(
                    """UPDATE contractors
                       SET verification_tier = 'tier_1',
                           verification_method = 'none'
                       WHERE id = %s""",
                    (c["id"],),
                )
                conn.commit()
                demoted += 1
                await publish_event("contractor.verification.expired", {
                    "contractor_id":  c["id"],
                    "company_name":   c["company_name_he"] or "",
                    "contact_name":   c["contact_name"] or "",
                    "contact_email":  c["contact_email"] or "",
                    "contact_phone":  c["contact_phone"] or "",
                })
        finally:
            conn.close()

    return {"checked": checked, "revalidated": revalidated, "demoted": demoted}
