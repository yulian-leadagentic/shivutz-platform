from fastapi import APIRouter, Query
from app.db import get_db
from typing import Optional

router = APIRouter()


@router.get("/admin/registration-log")
def get_registration_log(
    limit: int = Query(100, ge=1, le=500),
    status: Optional[str] = Query(None, description="failed | verified | all"),
):
    """
    Show recent registration OTP attempts from auth_db.sms_otp.
    - failed  = code was sent but never successfully verified (attempts > 0 OR expired)
    - verified = successfully verified
    - all      = everything
    """
    conn = get_db("auth_db")
    try:
        cur = conn.cursor()

        where = "WHERE o.purpose = 'register'"
        if status == "failed":
            where += " AND (o.verified_at IS NULL OR o.attempts > 0)"
        elif status == "verified":
            where += " AND o.verified_at IS NOT NULL"

        cur.execute(f"""
            SELECT
                o.otp_id,
                o.phone,
                o.purpose,
                o.attempts,
                o.created_at,
                o.expires_at,
                o.verified_at,
                o.ip_address,
                CASE
                    WHEN o.verified_at IS NOT NULL THEN 'verified'
                    WHEN o.expires_at < NOW()      THEN 'expired'
                    WHEN o.attempts >= 5           THEN 'locked'
                    WHEN o.attempts > 0            THEN 'failed_attempts'
                    ELSE 'pending'
                END AS status
            FROM sms_otp o
            {where}
            ORDER BY o.created_at DESC
            LIMIT %s
        """, (limit,))

        rows = cur.fetchall()
    finally:
        conn.close()

    return {
        "total": len(rows),
        "entries": [
            {
                "otp_id":      r["otp_id"],
                "phone":       r["phone"],
                "attempts":    r["attempts"],
                "status":      r["status"],
                "ip_address":  r["ip_address"],
                "created_at":  r["created_at"].isoformat() if r["created_at"] else None,
                "expires_at":  r["expires_at"].isoformat() if r["expires_at"] else None,
                "verified_at": r["verified_at"].isoformat() if r["verified_at"] else None,
            }
            for r in rows
        ],
    }
