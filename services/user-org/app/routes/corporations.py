from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, EmailStr
from typing import List, Optional
from datetime import datetime, timedelta
import uuid, httpx, os, json, secrets

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


class TeamInvite(BaseModel):
    phone: str
    role: str = "operator"    # owner | admin | operator | viewer
    job_title: Optional[str] = None


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
    """List team members from entity_memberships (phone-first, includes pending invitations)."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT em.membership_id, em.user_id, em.role, em.job_title,
                      em.is_active, em.invitation_accepted_at, em.created_at,
                      u.phone, u.full_name, u.email
               FROM auth_db.entity_memberships em
               LEFT JOIN auth_db.users u ON u.id = em.user_id
               WHERE em.entity_type = 'corporation' AND em.entity_id = %s
               ORDER BY em.created_at""",
            (org_id,)
        )
        rows = cur.fetchall()
        for r in rows:
            for col in ("invitation_accepted_at", "created_at"):
                if hasattr(r.get(col), "isoformat"):
                    r[col] = r[col].isoformat()
            r["pending"] = r["invitation_accepted_at"] is None
        return rows
    finally:
        conn.close()


@router.post("/{org_id}/users", status_code=201)
async def invite_corporation_user(
    org_id: str,
    data: TeamInvite,
    x_user_id: Optional[str] = Header(None),
):
    """Send a phone-based team invitation."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, company_name_he FROM corporations WHERE id = %s AND deleted_at IS NULL",
            (org_id,)
        )
        org = cur.fetchone()
        if not org:
            raise HTTPException(status_code=404, detail="Corporation not found")

        invite_token    = secrets.token_urlsafe(32)
        membership_id   = str(uuid.uuid4())
        inviter_user_id = x_user_id

        cur.execute(
            """INSERT INTO auth_db.entity_memberships
               (membership_id, user_id, entity_type, entity_id, role, job_title,
                invited_by, invitation_token, is_active)
               VALUES (%s, NULL, 'corporation', %s, %s, %s, %s, %s, FALSE)""",
            (membership_id,
             org_id, data.role, data.job_title, inviter_user_id, invite_token)
        )
        conn.commit()

        await publish_event("team.invited", {
            "phone":       data.phone.strip(),
            "entity_name": org["company_name_he"],
            "entity_type": "corporation",
            "role":        data.role,
            "invite_token": invite_token,
            "inviter_user_id": inviter_user_id,
        })

        return {"membership_id": membership_id, "role": data.role, "pending": True}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


# ── Documents ────────────────────────────────────────────────────────────────

class DocumentCreate(BaseModel):
    doc_type: str
    file_url: str
    file_name: str
    file_size: Optional[int] = None
    mime_type: Optional[str] = None
    notes: Optional[str] = None


@router.get("/{org_id}/documents")
def list_corporation_documents(org_id: str):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT doc_id, doc_type, file_name, file_url, file_size, mime_type,
                      is_valid, notes, uploaded_at, validated_at
               FROM auth_db.entity_documents
               WHERE entity_type = 'corporation' AND entity_id = %s
               ORDER BY uploaded_at DESC""",
            (org_id,)
        )
        rows = cur.fetchall()
        for r in rows:
            for col in ("uploaded_at", "validated_at"):
                if hasattr(r.get(col), "isoformat"):
                    r[col] = r[col].isoformat()
        return rows
    finally:
        conn.close()


@router.post("/{org_id}/documents", status_code=201)
def create_corporation_document(
    org_id: str,
    data: DocumentCreate,
    x_user_id: Optional[str] = Header(None),
):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT id FROM corporations WHERE id = %s AND deleted_at IS NULL", (org_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Corporation not found")

        doc_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO auth_db.entity_documents
               (doc_id, entity_type, entity_id, doc_type, file_url, file_name,
                file_size, mime_type, uploaded_by, notes)
               VALUES (%s, 'corporation', %s, %s, %s, %s, %s, %s, %s, %s)""",
            (doc_id, org_id, data.doc_type, data.file_url, data.file_name,
             data.file_size, data.mime_type, x_user_id, data.notes)
        )
        conn.commit()
        return {"doc_id": doc_id, "doc_type": data.doc_type, "file_name": data.file_name}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@router.delete("/{org_id}/documents/{doc_id}", status_code=204)
def delete_corporation_document(org_id: str, doc_id: str):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "DELETE FROM auth_db.entity_documents WHERE doc_id = %s AND entity_type = 'corporation' AND entity_id = %s",
            (doc_id, org_id)
        )
        conn.commit()
    finally:
        conn.close()
