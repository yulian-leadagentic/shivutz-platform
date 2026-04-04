from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, EmailStr
from typing import List, Optional
from datetime import datetime, timedelta
import uuid, httpx, os, json

from app.db import get_db
from app.publisher import publish_event

router = APIRouter()
AUTH_SERVICE = os.getenv("AUTH_SERVICE_URL", "http://auth:3001")


class CorporationCreate(BaseModel):
    company_name: Optional[str] = None          # defaults to company_name_he
    company_name_he: str
    business_number: str
    countries_of_origin: List[str]
    minimum_contract_months: int = 3
    contact_name: str                           # owner full name (also used as user.full_name)
    contact_phone: str                          # owner mobile (used as user.phone for SMS login)
    contact_email: Optional[EmailStr] = None    # optional business email
    # password removed — phone-first OTP registration


class OrgUserInvite(BaseModel):
    email: EmailStr
    password: str
    role: str = "staff"   # owner | manager | staff


@router.post("", status_code=201)
async def register_corporation(data: CorporationCreate):
    company_name = data.company_name or data.company_name_he
    org_id = str(uuid.uuid4())
    sla_deadline = datetime.utcnow() + timedelta(hours=48)

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO corporations
               (id, user_owner_id, company_name, company_name_he, business_number,
                countries_of_origin, minimum_contract_months, contact_name,
                contact_phone, contact_email, approval_sla_deadline)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (org_id, "PENDING", company_name, data.company_name_he,
             data.business_number, json.dumps(data.countries_of_origin),
             data.minimum_contract_months, data.contact_name,
             data.contact_phone, data.contact_email, sla_deadline)
        )

        # Phone-first registration — auth service verifies OTP was confirmed recently
        async with httpx.AsyncClient() as client:
            resp = await client.post(f"{AUTH_SERVICE}/auth/register", json={
                "phone":     data.contact_phone,
                "full_name": data.contact_name,
                "role":      "corporation",
                "org_id":    org_id,
                "org_type":  "corporation"
            })
            if resp.status_code == 409:
                conn.rollback()
                raise HTTPException(status_code=409, detail="Phone already registered")
            if resp.status_code == 400:
                conn.rollback()
                body = resp.json()
                raise HTTPException(status_code=400, detail=body.get("error", "registration_failed"))
            resp.raise_for_status()
            user = resp.json()

        cur.execute("UPDATE corporations SET user_owner_id = %s WHERE id = %s", (user["id"], org_id))
        # Legacy org_users row
        cur.execute(
            "INSERT INTO org_users (id, user_id, org_id, org_type, role, joined_at) VALUES (%s,%s,%s,%s,%s,NOW())",
            (str(uuid.uuid4()), user["id"], org_id, "corporation", "owner")
        )
        # New entity_memberships row in auth_db (same MySQL instance)
        cur.execute(
            """INSERT INTO auth_db.entity_memberships
               (membership_id, user_id, entity_type, entity_id, role, invitation_accepted_at, is_active)
               VALUES (%s, %s, 'corporation', %s, 'owner', NOW(), TRUE)
               ON DUPLICATE KEY UPDATE is_active = TRUE""",
            (str(uuid.uuid4()), user["id"], org_id)
        )
        conn.commit()

        await publish_event("org.registered", {
            "org_id": org_id,
            "org_name": company_name,
            "org_type": "corporation"
        })

        return {"id": org_id, "status": "pending", "message": "Registration submitted. Awaiting admin approval (up to 48h)."}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@router.get("/{org_id}")
def get_corporation(org_id: str):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM corporations WHERE id = %s AND deleted_at IS NULL", (org_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Corporation not found")
        return row
    finally:
        conn.close()


@router.get("/{org_id}/users")
def list_corporation_users(org_id: str):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT ou.id, ou.user_id, ou.role, ou.joined_at, u.email
               FROM org_users ou
               JOIN auth_db.users u ON u.id = ou.user_id
               WHERE ou.org_id = %s AND ou.deleted_at IS NULL""",
            (org_id,)
        )
        rows = cur.fetchall()
        for r in rows:
            if hasattr(r.get("joined_at"), "isoformat"):
                r["joined_at"] = r["joined_at"].isoformat()
        return rows
    finally:
        conn.close()


@router.post("/{org_id}/users", status_code=201)
async def invite_corporation_user(org_id: str, data: OrgUserInvite):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT id FROM corporations WHERE id = %s AND deleted_at IS NULL", (org_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Corporation not found")

        async with httpx.AsyncClient() as client:
            resp = await client.post(f"{AUTH_SERVICE}/auth/register", json={
                "email": data.email,
                "password": data.password,
                "role": "corporation",
                "org_id": org_id,
                "org_type": "corporation"
            })
            if resp.status_code == 409:
                raise HTTPException(status_code=409, detail="Email already registered")
            resp.raise_for_status()
            user = resp.json()

        cur.execute(
            "INSERT INTO org_users (id, user_id, org_id, org_type, role, joined_at) VALUES (%s,%s,%s,%s,%s,NOW())",
            (str(uuid.uuid4()), user["id"], org_id, "corporation", data.role)
        )
        conn.commit()
        return {"user_id": user["id"], "email": data.email, "role": data.role}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()
