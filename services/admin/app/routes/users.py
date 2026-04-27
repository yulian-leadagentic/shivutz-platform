"""Admin endpoints for managing platform users — list everyone, add a new
admin, disable / enable, and (light) status toggle on orgs.

Auth model: phone-first OTP. Adding an admin = inserting an `auth_db.users`
row with role='admin'. The new admin then logs in with their phone via the
existing /auth/login/otp flow. We send them a heads-up SMS with the
login URL via the `admin.user.added` event.
"""
import os
import re
import uuid
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel

from app.db import get_db

router = APIRouter()

NOTIF_URL    = os.getenv("NOTIFICATION_SERVICE_URL", "http://notification:3006")
FRONTEND_URL = os.getenv("FRONTEND_URL", "https://app.shivutz.co.il")


def _norm_phone(raw: str) -> str:
    """Normalize an Israeli phone number to +972XXXXXXXXX (matches auth/otp.js)."""
    digits = re.sub(r"\D", "", raw or "")
    if digits.startswith("972") and len(digits) == 12:
        return "+" + digits
    if digits.startswith("0") and len(digits) == 10:
        return "+972" + digits[1:]
    raise HTTPException(status_code=400, detail={"code": "invalid_phone", "message": "מספר טלפון לא תקין"})


def _serialize(row: dict) -> dict:
    for k, v in list(row.items()):
        if hasattr(v, "isoformat"):
            row[k] = v.isoformat()
    return row


# ── List users ─────────────────────────────────────────────────────────────

@router.get("/users")
def list_users(role: Optional[str] = None):
    """Every user in auth_db, with their primary org name (if any).

    Optional ?role=admin filter — handy for the new admin-management screen.
    """
    conn = get_db("auth_db")
    try:
        cur = conn.cursor()
        sql = """
            SELECT u.id, u.email, u.phone, u.full_name, u.role,
                   u.auth_method, u.is_active, u.last_login_at, u.created_at,
                   u.org_id, u.org_type,
                   COALESCE(c.company_name_he, c.company_name,
                            corp.company_name_he, corp.company_name) AS org_name
            FROM users u
            LEFT JOIN org_db.contractors  c    ON c.id    = u.org_id AND u.org_type = 'contractor'
            LEFT JOIN org_db.corporations corp ON corp.id = u.org_id AND u.org_type = 'corporation'
            WHERE u.deleted_at IS NULL
        """
        params: tuple = ()
        if role:
            sql += " AND u.role = %s"
            params = (role,)
        sql += " ORDER BY u.created_at DESC"
        cur.execute(sql, params)
        return [_serialize(r) for r in cur.fetchall()]
    finally:
        conn.close()


# ── Add a new admin user ───────────────────────────────────────────────────

class AdminUserIn(BaseModel):
    full_name: str
    phone: str


@router.post("/users/admin", status_code=201)
async def add_admin(body: AdminUserIn, x_user_id: Optional[str] = Header(default=None)):
    if not body.full_name.strip():
        raise HTTPException(status_code=400, detail={"code": "name_required", "message": "יש להזין שם"})
    norm = _norm_phone(body.phone)

    conn = get_db("auth_db")
    try:
        cur = conn.cursor()
        cur.execute("SELECT id, role FROM users WHERE phone=%s AND deleted_at IS NULL LIMIT 1",
                    (norm,))
        existing = cur.fetchone()
        if existing:
            raise HTTPException(status_code=409, detail={
                "code":    "phone_exists",
                "message": "מספר הטלפון כבר רשום במערכת",
                "user_id": existing["id"],
                "role":    existing["role"],
            })

        new_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO users
                 (id, phone, full_name, role, auth_method, is_active)
               VALUES (%s, %s, %s, 'admin', 'sms', TRUE)""",
            (new_id, norm, body.full_name.strip()),
        )
        conn.commit()
    finally:
        conn.close()

    # Best-effort SMS via notification's internal endpoint. If the notification
    # service is down the new admin can still log in via /login; they just
    # won't get the heads-up SMS.
    first_name = body.full_name.strip().split()[0]
    sms_body = (
        f"שיבוץ — {first_name}, נוספת כמנהל מערכת. "
        f"כניסה: {FRONTEND_URL}/login עם המספר הזה — קוד OTP יישלח בעת הכניסה."
    )
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            await client.post(f"{NOTIF_URL}/internal/sms",
                              json={"phone": norm, "message": sms_body})
    except httpx.HTTPError:
        pass

    return {"id": new_id, "phone": norm, "full_name": body.full_name.strip(), "role": "admin"}


# ── Disable / enable any user ──────────────────────────────────────────────

@router.patch("/users/{user_id}/disable", status_code=204)
def disable_user(user_id: str):
    conn = get_db("auth_db")
    try:
        cur = conn.cursor()
        cur.execute("UPDATE users SET is_active=FALSE WHERE id=%s AND deleted_at IS NULL", (user_id,))
        conn.commit()
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="user_not_found")
    finally:
        conn.close()


@router.patch("/users/{user_id}/enable", status_code=204)
def enable_user(user_id: str):
    conn = get_db("auth_db")
    try:
        cur = conn.cursor()
        cur.execute("UPDATE users SET is_active=TRUE WHERE id=%s AND deleted_at IS NULL", (user_id,))
        conn.commit()
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="user_not_found")
    finally:
        conn.close()


# ── Org status toggle (suspend / reactivate) ───────────────────────────────

class OrgStatusIn(BaseModel):
    status: str   # 'approved' | 'suspended'


@router.patch("/orgs/{org_id}/status")
def set_org_status(
    org_id: str,
    body: OrgStatusIn,
    org_type: str = "contractor",
    x_user_id: Optional[str] = Header(default=None),
):
    if body.status not in ("approved", "suspended", "rejected"):
        raise HTTPException(status_code=400, detail="invalid_status")
    if org_type not in ("contractor", "corporation"):
        raise HTTPException(status_code=400, detail="invalid_org_type")
    table = "contractors" if org_type == "contractor" else "corporations"

    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        cur.execute(
            f"UPDATE {table} SET approval_status=%s WHERE id=%s AND deleted_at IS NULL",
            (body.status, org_id),
        )
        conn.commit()
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="org_not_found")

        # Audit row in auth_db (same admin audit infra as approvals.py).
        import json
        audit_cur = conn.cursor()
        audit_cur.execute(
            """INSERT INTO auth_db.audit_log
                 (entity_type, entity_id, actor_id, action, metadata)
               VALUES (%s, %s, %s, %s, %s)""",
            (org_type, org_id, x_user_id or "admin", "status_changed",
             json.dumps({"new_status": body.status}, ensure_ascii=False)),
        )
        conn.commit()
        return {"id": org_id, "status": body.status}
    finally:
        conn.close()
