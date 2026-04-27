from fastapi import APIRouter, HTTPException, Header, UploadFile, File, Form
from pydantic import BaseModel, EmailStr
from typing import List, Literal, Optional
from datetime import datetime, timedelta
import uuid, httpx, os, json, secrets, shutil

from app.db import get_db
from app.publisher import publish_event
from app.services import verification, rate_limit
from app.integrations import data_gov_il
from app.integrations.israeli_id import is_valid_israeli_id

router = APIRouter()
AUTH_SERVICE = os.getenv("AUTH_SERVICE_URL", "http://auth:3001")
FRONTEND_URL = os.getenv("FRONTEND_URL", "https://app.shivutz.co.il")

# Pre-registration lookup is gated by a recent OTP + a per-phone rate limit
# (registration is low-volume, but a single user typing repeatedly should
# still be bounded — the registry calls cost us latency, not money).
LOOKUP_RATE_MAX = 20
LOOKUP_RATE_WINDOW_SECONDS = 600


class ContractorCreate(BaseModel):
    company_name: Optional[str] = None          # defaults to company_name_he
    company_name_he: str
    business_number: str
    operating_regions: List[str]
    contact_name: str                           # owner full name (also used as user.full_name)
    contact_phone: str                          # owner mobile (used as user.phone for SMS login)
    contact_email: Optional[EmailStr] = None    # optional business email
    # No classification — pulled live from פנקס הקבלנים (kvutza + sivug).


class LookupRequest(BaseModel):
    business_number: str
    phone: str                                  # the OTP-verified phone gating this lookup


class VerifyStart(BaseModel):
    channel: Literal["email", "sms"]
    target: str                                 # the email or phone the user picked


class VerifyConfirm(BaseModel):
    channel: Literal["email", "sms"]
    secret: str                                 # code (6 digits) or magic-link token


class TeamInvite(BaseModel):
    phone: str                              # invitee mobile — will be normalised by auth service
    role: str = "operator"                  # owner | admin | operator | viewer
    job_title: Optional[str] = None


@router.post("/lookup")
async def lookup_business_number(data: LookupRequest):
    """Pre-registration lookup: validate business_number checksum + cross-check
    both data.gov.il registries. Frontend calls this on-blur to prefill the
    form and surface available verification channels.

    Gate: requires a recent verified 'register' OTP for the supplied phone,
    and is rate-limited per phone (20 / 10 minutes).
    """
    if not rate_limit.check(
        f"lookup:{data.phone}", LOOKUP_RATE_MAX, LOOKUP_RATE_WINDOW_SECONDS
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

    return await verification.quick_lookup(data.business_number)


@router.post("", status_code=201)
async def register_contractor(data: ContractorCreate):
    if not is_valid_israeli_id(data.business_number):
        raise HTTPException(status_code=400, detail="invalid_business_number")

    lookup = await verification.quick_lookup(data.business_number)

    if lookup.get("blocked"):
        # Block + admin notification — company is מחוקה / בפירוק.
        await publish_event("contractor.blocked.deleted_company", {
            "business_number":  data.business_number,
            "company_status":   lookup.get("block_reason"),
            "contact_name":     data.contact_name,
            "contact_phone":    data.contact_phone,
            "attempted_at":     datetime.utcnow().isoformat() + "Z",
        })
        raise HTTPException(
            status_code=422,
            detail={
                "code": "company_blocked",
                "message": f"החברה רשומה במצב '{lookup.get('block_reason')}' ברשם החברות. הרישום אינו אפשרי.",
                "company_status": lookup.get("block_reason"),
            },
        )

    prefill = lookup.get("prefill") or {}
    company_name_he = prefill.get("company_name_he") or data.company_name_he
    company_name = data.company_name or company_name_he

    # quick_lookup already exposes ica status as gov_company_status; derive the
    # active flag from it without re-hitting the registry.
    status = lookup.get("gov_company_status")
    company_active = (status == "פעילה") if status else None
    initial_tier = verification.initial_tier_for(
        pinkash_found=lookup.get("pinkash_found", False),
        ica_found=lookup.get("ica_found", False),
        company_active=company_active,
    )

    org_id = str(uuid.uuid4())
    sla_deadline = datetime.utcnow() + timedelta(hours=48)

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO contractors
               (id, user_owner_id, company_name, company_name_he, business_number,
                kablan_number, kvutza, sivug, gov_branch, gov_company_status,
                operating_regions, contact_name, contact_phone, contact_email,
                verification_tier, approval_sla_deadline)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (org_id, "PENDING", company_name, company_name_he,
             data.business_number,
             prefill.get("kablan_number"),
             prefill.get("kvutza"),
             prefill.get("sivug"),
             prefill.get("gov_branch"),
             lookup.get("gov_company_status"),
             json.dumps(data.operating_regions), data.contact_name,
             data.contact_phone, data.contact_email,
             initial_tier, sla_deadline)
        )

        # Phone-first registration — auth service verifies OTP was confirmed recently
        async with httpx.AsyncClient() as client:
            resp = await client.post(f"{AUTH_SERVICE}/auth/register", json={
                "phone":          data.contact_phone,
                "full_name":      data.contact_name,
                "role":           "contractor",
                "org_id":         org_id,
                "org_type":       "contractor",
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

        cur.execute("UPDATE contractors SET user_owner_id = %s WHERE id = %s", (user["id"], org_id))
        # Legacy org_users row — UPSERT because uq_user_id only allows one org per
        # user in the legacy table. The new entity_memberships row below tracks
        # multiple memberships properly.
        cur.execute(
            """INSERT INTO org_users (id, user_id, org_id, org_type, role, joined_at)
               VALUES (%s,%s,%s,%s,%s,NOW())
               ON DUPLICATE KEY UPDATE
                 org_id = VALUES(org_id),
                 org_type = VALUES(org_type),
                 role = VALUES(role),
                 joined_at = NOW()""",
            (str(uuid.uuid4()), user["id"], org_id, "contractor", "owner")
        )
        # New entity_memberships row in auth_db (same MySQL instance)
        cur.execute(
            """INSERT INTO auth_db.entity_memberships
               (membership_id, user_id, entity_type, entity_id, role, invitation_accepted_at, is_active)
               VALUES (%s, %s, 'contractor', %s, 'owner', NOW(), TRUE)
               ON DUPLICATE KEY UPDATE is_active = TRUE""",
            (str(uuid.uuid4()), user["id"], org_id)
        )
        conn.commit()

        await publish_event("org.registered", {
            "org_id": org_id,
            "org_name": company_name,
            "org_type": "contractor"
        })

        return {
            "id":                  org_id,
            "status":              "pending",
            "org_type":            "contractor",
            "verification_tier":   initial_tier,
            "registry_found":      lookup.get("pinkash_found", False),
            "available_channels":  lookup.get("channels", []),
            "access_token":        user.get("access_token"),
            "refresh_token":       user.get("refresh_token"),
        }
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@router.post("/{org_id}/verify/start")
async def verify_start(org_id: str, data: VerifyStart):
    """Issue a verification token on the chosen channel and dispatch the
    notification (email magic link or SMS code)."""
    result = verification.start_verification(org_id, data.channel, data.target)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "verify_start_failed"))

    if data.channel == "email":
        magic_link = (
            f"{FRONTEND_URL}/register/contractor/verify?"
            f"contractor_id={org_id}&token={result['send']['token']}"
        )
        await publish_event("contractor.verify.email_link", {
            "recipient_email":    data.target,
            "contact_name":       result.get("contact_name") or "",
            "magic_link":         magic_link,
            "expires_in_minutes": 30,
        })
    else:  # sms
        await publish_event("contractor.verify.sms_code", {
            "phone":        data.target,
            "contact_name": result.get("contact_name") or "",
            "code":         result["send"]["code"],
        })

    return {
        "ok":         True,
        "channel":    data.channel,
        "expires_at": result["expires_at"],
    }


@router.post("/{org_id}/verify/confirm")
async def verify_confirm(org_id: str, data: VerifyConfirm):
    """Validate the user-supplied secret. On success the contractor moves to
    tier_2 and approval_status flips to 'approved'. Fires
    `contractor.verified` so the user gets a confirmation email + SMS."""
    result = verification.confirm_verification(org_id, data.channel, data.secret)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "verify_failed"))

    # Best-effort: pull contact info to enrich the success notification.
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT contact_name, contact_email, contact_phone, company_name_he
               FROM contractors WHERE id = %s""",
            (org_id,),
        )
        c = cur.fetchone() or {}
    finally:
        conn.close()

    await publish_event("contractor.verified", {
        "contractor_id":       org_id,
        "company_name":        c.get("company_name_he") or "",
        "contact_name":        c.get("contact_name") or "",
        "contact_email":       c.get("contact_email") or "",
        "contact_phone":       c.get("contact_phone") or "",
        "verification_method": data.channel,
    })
    return result


@router.get("/{org_id}")
def get_contractor(org_id: str):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM contractors WHERE id = %s AND deleted_at IS NULL", (org_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Contractor not found")
        return row
    finally:
        conn.close()


@router.get("/{org_id}/users")
def list_contractor_users(org_id: str):
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
               WHERE em.entity_type = 'contractor' AND em.entity_id = %s
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
async def invite_contractor_user(
    org_id: str,
    data: TeamInvite,
    x_user_id: Optional[str] = Header(None),
):
    """Send a phone-based team invitation. Creates entity_membership (pending) and sends SMS via RabbitMQ."""
    conn = get_db()
    try:
        cur = conn.cursor()
        # Verify org exists and get name for the SMS
        cur.execute(
            "SELECT id, company_name_he FROM contractors WHERE id = %s AND deleted_at IS NULL",
            (org_id,)
        )
        org = cur.fetchone()
        if not org:
            raise HTTPException(status_code=404, detail="Contractor not found")

        invite_token    = secrets.token_urlsafe(32)
        membership_id   = str(uuid.uuid4())
        inviter_user_id = x_user_id  # set by gateway from JWT

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

        # Create pending membership (no user_id yet — filled on acceptance)
        cur.execute(
            """INSERT INTO auth_db.entity_memberships
               (membership_id, user_id, entity_type, entity_id, role, job_title,
                invited_by, invitation_token, is_active)
               VALUES (%s, NULL, 'contractor', %s, %s, %s, %s, %s, FALSE)""",
            (membership_id,
             org_id, data.role, data.job_title, inviter_user_id, invite_token)
        )
        conn.commit()

        # Normalise phone for the SMS payload (best-effort; auth will normalise properly on accept)
        raw_phone = data.phone.strip()

        await publish_event("team.invited", {
            "phone":        raw_phone,
            "entity_name":  org["company_name_he"] or "",
            "entity_type":  "contractor",
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
    doc_type: str     # registration_cert | contractor_license | foreign_worker_license | id_copy | other
    file_url: str
    file_name: str
    file_size: Optional[int] = None
    mime_type: Optional[str] = None
    notes: Optional[str] = None


@router.get("/{org_id}/documents")
def list_contractor_documents(org_id: str):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT doc_id, doc_type, file_name, file_url, file_size, mime_type,
                      is_valid, notes, uploaded_at, validated_at
               FROM auth_db.entity_documents
               WHERE entity_type = 'contractor' AND entity_id = %s
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
def create_contractor_document(
    org_id: str,
    data: DocumentCreate,
    x_user_id: Optional[str] = Header(None),
):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT id FROM contractors WHERE id = %s AND deleted_at IS NULL", (org_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Contractor not found")

        doc_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO auth_db.entity_documents
               (doc_id, entity_type, entity_id, doc_type, file_url, file_name,
                file_size, mime_type, uploaded_by, notes)
               VALUES (%s, 'contractor', %s, %s, %s, %s, %s, %s, %s, %s)""",
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
async def upload_contractor_document(
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
        cur.execute("SELECT id FROM contractors WHERE id = %s AND deleted_at IS NULL", (org_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Contractor not found")

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
               VALUES (%s, 'contractor', %s, %s, %s, %s, %s, %s, %s, %s)""",
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
def delete_contractor_document(org_id: str, doc_id: str):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "DELETE FROM auth_db.entity_documents WHERE doc_id = %s AND entity_type = 'contractor' AND entity_id = %s",
            (doc_id, org_id)
        )
        conn.commit()
    finally:
        conn.close()
