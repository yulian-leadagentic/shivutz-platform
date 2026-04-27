from fastapi import APIRouter, HTTPException, Header, UploadFile, File, Form
from pydantic import BaseModel, EmailStr
from typing import List, Optional
from datetime import datetime, timedelta
import uuid, httpx, os, json, secrets, shutil

from app.db import get_db
from app.publisher import publish_event
from app.services import rate_limit
from app.integrations import data_gov_il
from app.integrations.israeli_id import is_valid_israeli_id

router = APIRouter()
AUTH_SERVICE = os.getenv("AUTH_SERVICE_URL", "http://auth:3001")

# Pre-registration lookup is gated by a recent OTP + a per-phone rate limit
# (same shape as the contractor lookup).
LOOKUP_RATE_MAX = 20
LOOKUP_RATE_WINDOW_SECONDS = 600


class CorporationCreate(BaseModel):
    company_name: Optional[str] = None          # defaults to company_name_he
    company_name_he: str
    business_number: str
    countries_of_origin: List[str]
    minimum_contract_months: int = 3
    contact_name: str                           # owner full name (also used as user.full_name)
    contact_phone: str                          # owner mobile (used as user.phone for SMS login)
    contact_email: Optional[EmailStr] = None    # optional business email
    tc_version: Optional[str] = None            # T&C version the corp accepted (required for tier_2 path)
    # password removed — phone-first OTP registration


class CorpLookupRequest(BaseModel):
    business_number: str
    phone: str                                  # the OTP-verified phone gating this lookup


class TeamInvite(BaseModel):
    phone: str
    role: str = "operator"    # owner | admin | operator | viewer
    job_title: Optional[str] = None


@router.post("/lookup")
async def lookup_corporation_business(data: CorpLookupRequest):
    """Pre-registration lookup against רשם החברות only — corporations are
    not in פנקס הקבלנים. Returns prefill (company name, status) and a
    `blocked` flag if the company is מחוקה / בפירוק.

    Same OTP gate + per-phone rate limit as the contractor lookup.
    """
    if not rate_limit.check(
        f"corp-lookup:{data.phone}", LOOKUP_RATE_MAX, LOOKUP_RATE_WINDOW_SECONDS
    ):
        raise HTTPException(status_code=429, detail="rate_limited")

    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            otp_resp = await client.post(
                f"{AUTH_SERVICE}/auth/check-recent-otp",
                json={"phone": data.phone, "purpose": "register"},
            )
        except httpx.HTTPError:
            raise HTTPException(status_code=503, detail="auth_service_unreachable")
        if otp_resp.status_code != 200:
            raise HTTPException(status_code=401, detail="phone_not_verified")

    if not is_valid_israeli_id(data.business_number):
        return {
            "ok": False,
            "error": "invalid_business_number",
            "message": "מספר ע.מ / ח.פ אינו תקין (checksum נכשל)",
        }

    result = await data_gov_il.lookup(data.business_number)
    ica_fields = data_gov_il.extract_ica_fields(result["ica"]) if result["ica"] else {}
    company_active = data_gov_il.is_company_active(result["ica"])
    blocked = result["ica_found"] and company_active is False

    return {
        "ok": True,
        "blocked": blocked,
        "block_reason": ica_fields.get("gov_company_status") if blocked else None,
        "ica_found": result["ica_found"],
        "gov_company_status": ica_fields.get("gov_company_status"),
        "prefill": {
            "company_name_he": ica_fields.get("company_name_he"),
        },
        "from_cache": result["from_cache"],
    }


@router.post("", status_code=201)
async def register_corporation(data: CorporationCreate):
    if not is_valid_israeli_id(data.business_number):
        raise HTTPException(status_code=400, detail="invalid_business_number")

    # Cross-check רשם החברות. Corporations don't have an email/sms self-
    # verification path; tier_2 ("תאגיד מאושר") is admin-only.
    registry = await data_gov_il.lookup(data.business_number)
    ica_fields = data_gov_il.extract_ica_fields(registry["ica"]) if registry["ica"] else {}
    company_active = data_gov_il.is_company_active(registry["ica"])

    if registry["ica_found"] and company_active is False:
        await publish_event("contractor.blocked.deleted_company", {
            "business_number": data.business_number,
            "company_status":  ica_fields.get("gov_company_status"),
            "contact_name":    data.contact_name,
            "contact_phone":   data.contact_phone,
            "attempted_at":    datetime.utcnow().isoformat() + "Z",
        })
        raise HTTPException(
            status_code=422,
            detail={
                "code": "company_blocked",
                "message": f"החברה רשומה במצב '{ica_fields.get('gov_company_status')}' ברשם החברות. הרישום אינו אפשרי.",
                "company_status": ica_fields.get("gov_company_status"),
            },
        )

    company_name_he = ica_fields.get("company_name_he") or data.company_name_he
    company_name = data.company_name or company_name_he
    initial_tier = "tier_1" if (registry["ica_found"] and company_active) else "tier_0"

    org_id = str(uuid.uuid4())
    sla_deadline = datetime.utcnow() + timedelta(hours=48)

    conn = get_db()
    try:
        cur = conn.cursor()
        tc_signed_at = datetime.utcnow() if data.tc_version else None
        cur.execute(
            """INSERT INTO corporations
               (id, user_owner_id, company_name, company_name_he, business_number,
                gov_company_status, verification_tier,
                countries_of_origin, minimum_contract_months, contact_name,
                contact_phone, contact_email, approval_sla_deadline,
                tc_version, tc_signed_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (org_id, "PENDING", company_name, company_name_he,
             data.business_number,
             ica_fields.get("gov_company_status"),
             initial_tier,
             json.dumps(data.countries_of_origin),
             data.minimum_contract_months, data.contact_name,
             data.contact_phone, data.contact_email, sla_deadline,
             data.tc_version, tc_signed_at)
        )

        # Phone-first registration — auth service verifies OTP was confirmed recently
        async with httpx.AsyncClient() as client:
            resp = await client.post(f"{AUTH_SERVICE}/auth/register", json={
                "phone":          data.contact_phone,
                "full_name":      data.contact_name,
                "role":           "corporation",
                "org_id":         org_id,
                "org_type":       "corporation",
                "include_tokens": True,
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
        # Legacy org_users row — UPSERT (uq_user_id only allows one org per
        # user in the legacy table; the new entity_memberships row below
        # tracks multiple memberships).
        cur.execute(
            """INSERT INTO org_users (id, user_id, org_id, org_type, role, joined_at)
               VALUES (%s,%s,%s,%s,%s,NOW())
               ON DUPLICATE KEY UPDATE
                 org_id = VALUES(org_id),
                 org_type = VALUES(org_type),
                 role = VALUES(role),
                 joined_at = NOW()""",
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

        return {
            "id":                org_id,
            "status":            "pending",
            "org_type":          "corporation",
            "verification_tier": initial_tier,
            "registry_found":    registry["ica_found"],
            "access_token":      user.get("access_token"),
            "refresh_token":     user.get("refresh_token"),
        }
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

        # Resolve inviter's name for the SMS (best-effort)
        inviter_name = None
        if inviter_user_id:
            cur.execute(
                "SELECT full_name FROM auth_db.users WHERE id = %s LIMIT 1",
                (inviter_user_id,)
            )
            u = cur.fetchone()
            if u and u.get("full_name"):
                inviter_name = u["full_name"]

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
            "phone":        data.phone.strip(),
            "entity_name":  org["company_name_he"] or "",
            "entity_type":  "corporation",
            "role":         data.role,
            "invite_token": invite_token,
            "inviter_name": inviter_name or org.get("company_name_he") or "המנהל",
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


@router.post("/{org_id}/documents/upload", status_code=201)
async def upload_corporation_document(
    org_id: str,
    file: UploadFile = File(...),
    doc_type: str = Form("other"),
    notes: str = Form(""),
    x_user_id: Optional[str] = Header(None),
):
    """Accept a file upload, store it, and create a document record."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT id FROM corporations WHERE id = %s AND deleted_at IS NULL", (org_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Corporation not found")

        upload_dir = os.getenv("UPLOAD_DIR", "/app/uploads")
        os.makedirs(upload_dir, exist_ok=True)

        doc_id   = str(uuid.uuid4())
        ext      = os.path.splitext(file.filename or "")[-1].lower() if file.filename else ""
        safe_ext = ext if ext in (".pdf", ".jpg", ".jpeg", ".png", ".doc", ".docx", ".xls", ".xlsx") else ".bin"
        saved_name = f"{doc_id}{safe_ext}"
        dest_path  = os.path.join(upload_dir, saved_name)

        with open(dest_path, "wb") as f:
            shutil.copyfileobj(file.file, f)

        file_url  = f"/api/uploads/{saved_name}"
        file_name = file.filename or saved_name
        file_size = os.path.getsize(dest_path)
        mime_type = file.content_type or "application/octet-stream"

        cur.execute(
            """INSERT INTO auth_db.entity_documents
               (doc_id, entity_type, entity_id, doc_type, file_url, file_name,
                file_size, mime_type, uploaded_by, notes)
               VALUES (%s, 'corporation', %s, %s, %s, %s, %s, %s, %s, %s)""",
            (doc_id, org_id, doc_type, file_url, file_name,
             file_size, mime_type, x_user_id, notes or None)
        )
        conn.commit()
        return {"doc_id": doc_id, "doc_type": doc_type, "file_name": file_name, "file_url": file_url}
    except HTTPException:
        raise
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
