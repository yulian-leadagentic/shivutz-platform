from fastapi import APIRouter, HTTPException, Header, UploadFile, File, Form
from pydantic import BaseModel, EmailStr
from typing import List, Optional
from datetime import datetime, timedelta
import uuid, httpx, os, json, secrets, shutil

from app.db import get_db
from app.publisher import publish_event
from app.services import rate_limit
from app.services import notification_recipients as notif_recipients
from app.services import team_membership as team_mgmt
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
    role: str = "admin"       # owner | admin | viewer  (operator dropped Wave 2)
    job_title:  Optional[str] = None
    # First/last name added Wave 2 — captured by inviter so the pending
    # row in the team UI shows who they invited.
    first_name: Optional[str] = None
    last_name:  Optional[str] = None


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

    # Block duplicate corporation registration for the same phone.
    # Same reasoning as the contractor route — without this the same
    # phone accumulates extra corporation memberships in the picker.
    conn = get_db()
    with conn.cursor() as cur:
        cur.execute(
            """SELECT 1
               FROM auth_db.entity_memberships em
               JOIN auth_db.users u ON u.id = em.user_id
               WHERE u.phone = %s
                 AND em.entity_type = 'corporation'
                 AND em.is_active = TRUE
               LIMIT 1""",
            (data.contact_phone,),
        )
        if cur.fetchone():
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "phone_already_corporation",
                    "message": "מספר טלפון זה כבר רשום כתאגיד. אנא היכנס במקום להירשם, או פנה לתמיכה.",
                },
            )

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

    # ── Cross-check against the רשות האוכלוסין annual list ──────────
    # If the corp's business_number appears in the most-recent uploaded
    # year's file, fast-path them to tier_2 with verification_method=
    # 'gov_list_match'. Otherwise keep the existing pending-admin flow.
    gov_row = None
    gov_year = None
    conn_lookup = get_db()
    try:
        cur_l = conn_lookup.cursor()
        cur_l.execute(
            """SELECT id, source_year, company_name_he, address,
                      phone_mobile_1, phone_mobile_2,
                      phone_landline_1, phone_landline_2
               FROM gov_corporations_registry
               WHERE business_number = %s
               ORDER BY source_year DESC LIMIT 1""",
            (data.business_number,),
        )
        gov_row = cur_l.fetchone()
        gov_year = gov_row.get("source_year") if gov_row else None
    finally:
        conn_lookup.close()

    matched_gov = gov_row is not None
    final_tier = "tier_2" if matched_gov else initial_tier
    verification_method = "gov_list_match" if matched_gov else None
    now = datetime.utcnow()
    verified_at = now if matched_gov else None
    gov_matched_at = now if matched_gov else None
    approval_status = "approved" if matched_gov else "pending"
    approved_at = now if matched_gov else None

    # Prefill corp fields from the gov row when the corp didn't supply
    # them. We never OVERWRITE user-typed values — corps that want to
    # use different details (e.g. a moved office) can still set them.
    prefill_address = gov_row.get("address") if matched_gov else None
    prefill_landline_1 = gov_row.get("phone_landline_1") if matched_gov else None
    prefill_landline_2 = gov_row.get("phone_landline_2") if matched_gov else None
    prefill_mobile_2 = gov_row.get("phone_mobile_2") if matched_gov else None
    # If the gov list has a name that's more "official" than what the
    # user typed, prefer the gov one for company_name_he.
    if matched_gov and gov_row.get("company_name_he"):
        company_name_he = gov_row["company_name_he"]
        company_name = data.company_name or company_name_he

    org_id = str(uuid.uuid4())
    sla_deadline = now + timedelta(hours=48)

    conn = get_db()
    try:
        cur = conn.cursor()
        tc_signed_at = now if data.tc_version else None
        cur.execute(
            """INSERT INTO corporations
               (id, user_owner_id, company_name, company_name_he, business_number,
                gov_company_status, verification_tier, verification_method,
                gov_registry_source_year, gov_registry_matched_at, verified_at,
                approval_status, approved_at,
                phone_landline, phone_landline_secondary, phone_mobile_secondary,
                countries_of_origin, minimum_contract_months, contact_name,
                contact_phone, contact_email, approval_sla_deadline,
                tc_version, tc_signed_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (org_id, "PENDING", company_name, company_name_he,
             data.business_number,
             ica_fields.get("gov_company_status"),
             final_tier, verification_method,
             gov_year, gov_matched_at, verified_at,
             approval_status, approved_at,
             prefill_landline_1, prefill_landline_2, prefill_mobile_2,
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
            # 'approved' when the gov list matched, otherwise 'pending'
            # for the admin queue (existing behaviour).
            "status":            approval_status,
            "org_type":          "corporation",
            "verification_tier": final_tier,
            "registry_found":    registry["ica_found"],
            "gov_list_matched":  matched_gov,
            "gov_list_year":     gov_year,
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


@router.get("")
def list_corporations(
    tier: Optional[str] = None,
    recruitment_type: Optional[str] = None,
):
    """Internal-use directory query — returns the lightweight subset
    of corporation rows needed by the notification service to fan
    out SMS for the search.no_match event.

    Filters (both optional):
      - tier:             'tier_2' restricts to admin-approved corps
      - recruitment_type: 'foreign'|'domestic' — corp must list at
                          least one matching country in
                          countries_of_origin (foreign) or have
                          domestic-recruit enabled.

    Note: this endpoint is reachable only via internal Docker
    networking (user-org:3002 isn't published to host). The gateway
    doesn't proxy GET on this path; if you need to expose it
    externally later, add an admin-only guard.
    """
    conn = get_db()
    try:
        cur = conn.cursor()
        filters = ["deleted_at IS NULL", "approval_status = 'approved'"]
        params: list = []
        if tier:
            filters.append("verification_tier = %s")
            params.append(tier)
        # countries_of_origin is a JSON array column. "foreign" means
        # any non-IL country; "domestic" means the corp explicitly
        # listed Israel. We treat unset recruitment_type as no filter.
        if recruitment_type == 'foreign':
            filters.append("JSON_LENGTH(countries_of_origin) > 0")
            filters.append("NOT JSON_CONTAINS(countries_of_origin, '\"IL\"')")
        elif recruitment_type == 'domestic':
            filters.append("JSON_CONTAINS(countries_of_origin, '\"IL\"')")
        where = " AND ".join(filters)
        cur.execute(
            f"""SELECT id, company_name, company_name_he, contact_name,
                       contact_phone, contact_email, verification_tier,
                       countries_of_origin
                  FROM corporations
                 WHERE {where}""",
            tuple(params),
        )
        return cur.fetchall()
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
                      em.invited_first_name, em.invited_last_name,
                      COALESCE(u.phone, em.invited_phone) AS phone,
                      u.full_name, u.email
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
            # Surface the inviter-provided name on pending rows (the
            # joined users.full_name is null until the invitee accepts).
            if not r.get("full_name") and (r.get("invited_first_name") or r.get("invited_last_name")):
                r["full_name"] = f"{r.get('invited_first_name','') or ''} {r.get('invited_last_name','') or ''}".strip()
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
                invited_first_name, invited_last_name, invited_phone,
                invited_by, invitation_token, is_active)
               VALUES (%s, NULL, 'corporation', %s, %s, %s, %s, %s, %s, %s, %s, FALSE)""",
            (membership_id,
             org_id, data.role, data.job_title,
             (data.first_name or '').strip() or None,
             (data.last_name  or '').strip() or None,
             data.phone.strip() or None,
             inviter_user_id, invite_token)
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


@router.delete("/{org_id}/users/{membership_id}", status_code=204)
def delete_corporation_user(
    org_id: str,
    membership_id: str,
    x_user_id:   Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Hard-delete a team membership (active or pending). Cleans up the
    notification_recipients row for the same (entity, user) pair. Role
    gate: corp admin/owner or platform admin. Sole-owner protection."""
    team_mgmt.delete_membership(
        entity_type="corporation",
        entity_id=org_id,
        membership_id=membership_id,
        caller_user_id=x_user_id,
        caller_role=x_user_role,
    )


class TeamMemberPatch(BaseModel):
    role:               Optional[str] = None      # owner | admin | viewer
    job_title:          Optional[str] = None      # "" → clear
    # Pending-only — silently ignored on active rows (user_id IS NOT NULL).
    invited_first_name: Optional[str] = None
    invited_last_name:  Optional[str] = None
    invited_phone:      Optional[str] = None


@router.patch("/{org_id}/users/{membership_id}")
async def update_corporation_user(
    org_id: str,
    membership_id: str,
    data: TeamMemberPatch,
    x_user_id:   Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Edit role / job title (active or pending) and — for pending rows
    only — the invited name + phone. Phone change resends the SMS to
    the new number with the same invitation_token."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT company_name_he FROM corporations WHERE id = %s AND deleted_at IS NULL",
            (org_id,),
        )
        org = cur.fetchone()
    finally:
        conn.close()
    if not org:
        raise HTTPException(status_code=404, detail="Corporation not found")

    return await team_mgmt.update_membership(
        entity_type="corporation",
        entity_id=org_id,
        membership_id=membership_id,
        patch=data.dict(exclude_unset=True),
        caller_user_id=x_user_id,
        caller_role=x_user_role,
        entity_name=org.get("company_name_he"),
    )


# ── Notification recipients ──────────────────────────────────────────
@router.get("/{org_id}/notification-recipients")
def list_corporation_notification_recipients(org_id: str):
    """List all active team members joined with their recipient state.
    Non-recipients come back with is_recipient=false / channels=[]."""
    return notif_recipients.list_recipients("corporation", org_id)


@router.put("/{org_id}/notification-recipients/{user_id}")
def upsert_corporation_notification_recipient(
    org_id: str,
    user_id: str,
    body: notif_recipients.RecipientUpsert,
    x_user_id:   Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Flag/unflag a team member as a notification recipient + choose
    their channels. Role gate: corp admin/owner OR the user themselves
    (for self opt-out). Max-5 cap is enforced in the service layer."""
    return notif_recipients.upsert_recipient(
        entity_type="corporation",
        entity_id=org_id,
        target_user_id=user_id,
        body=body,
        caller_user_id=x_user_id,
        caller_role=x_user_role,
    )


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
