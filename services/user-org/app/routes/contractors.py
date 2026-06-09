from fastapi import APIRouter, HTTPException, Header, UploadFile, File, Form
from pydantic import BaseModel, EmailStr
from typing import List, Literal, Optional
from datetime import datetime, timedelta
import uuid, httpx, os, json, secrets, shutil

from app.db import get_db
from app.publisher import publish_event
from app.services import verification, rate_limit
from app.services import notification_recipients as notif_recipients
from app.services import team_membership as team_mgmt
from app.services import membership_requests as mreq
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
    # מספר רישיון קבלן — REQUIRED. Cross-checked against MISPAR_KABLAN
    # in פנקס הקבלנים for the same business_number. On mismatch the
    # registration still completes but lands in the admin-approval
    # queue with verification_method='kablan_mismatch_pending' instead
    # of getting automatic tier_2.
    kablan_number: str


class LookupRequest(BaseModel):
    business_number: str
    phone: str                                  # the OTP-verified phone gating this lookup


class VerifyStart(BaseModel):
    channel: Literal["email", "sms"]
    target: str                                 # the email or phone the user picked


class VerifyConfirm(BaseModel):
    channel: Literal["email", "sms"]
    secret: str                                 # code (6 digits) or magic-link token


class VerifyKablan(BaseModel):
    kablan_number: str   # the מספר רישיון קבלן the user is claiming


class TeamInvite(BaseModel):
    phone: str                              # invitee mobile — will be normalised by auth service
    role: str = "admin"                     # owner | admin | viewer  (operator dropped Wave 2)
    job_title:  Optional[str] = None
    # First/last name added Wave 2 — captured by the inviter so the
    # pending-row in the team UI shows who they invited (the user
    # account doesn't exist yet, so users.full_name is null until accept).
    first_name: Optional[str] = None
    last_name:  Optional[str] = None


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

    # ── Duplicate ח.פ guard ────────────────────────────────────────
    # Same pattern as the corp register endpoint — if a contractor
    # with this business_number is already on file, capture the new
    # user as a membership_request and SMS the existing owner(s).
    existing = mreq.find_existing_active_org(data.business_number, "contractor")
    if existing:
        owners = mreq.owners_for("contractor", existing["id"])
        request = mreq.create_request(
            entity_type="contractor",
            entity_id=existing["id"],
            requester_phone=data.contact_phone,
            requester_name=data.contact_name,
            requester_email=data.contact_email,
            requested_role="admin",
        )
        for owner in owners:
            await publish_event("team.membership_request.created", {
                "owner_phone":     owner.get("phone"),
                "owner_name":      owner.get("full_name") or "",
                "entity_type":     "contractor",
                "entity_name":     existing.get("company_name_he") or existing.get("company_name") or "",
                "requester_name":  data.contact_name,
                "requester_phone": data.contact_phone,
                "approval_token":  request["approval_token"],
                "expires_at":      request["expires_at"],
            })
        raise HTTPException(
            status_code=409,
            detail={
                "code": "contractor_already_registered",
                "message": "קבלן עם ח.פ זה כבר רשום במערכת. שלחנו לבעלים הקיים הודעת SMS ובה קישור לאישור הוספתך כחבר צוות.",
                "existing_company_name": existing.get("company_name_he") or existing.get("company_name"),
                "request_token": request["approval_token"],
            },
        )

    # Block duplicate contractor registration for the same phone. The
    # unique constraint on entity_memberships only catches re-using the
    # same entity_id — without this guard, the same phone can sign up
    # again and again, each time creating a fresh contractor entity and
    # accumulating extra memberships in the picker.
    conn = get_db()
    with conn.cursor() as cur:
        cur.execute(
            """SELECT 1
               FROM auth_db.entity_memberships em
               JOIN auth_db.users u ON u.id = em.user_id
               WHERE u.phone = %s
                 AND em.entity_type = 'contractor'
                 AND em.is_active = TRUE
               LIMIT 1""",
            (data.contact_phone,),
        )
        if cur.fetchone():
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "phone_already_contractor",
                    "message": "מספר טלפון זה כבר רשום כקבלן. אנא היכנס במקום להירשם, או פנה לתמיכה.",
                },
            )

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

    # Cross-check the user-typed kablan_number against פנקס הקבלנים.
    # Outcomes:
    #   match=True  → fast-path to tier_2 (stronger proof than email/SMS).
    #   match=False → registration completes but lands in admin queue
    #                 (approval_status='pending'). Admin can override.
    #   ok=False    → data.gov.il was unreachable; treat as mismatch
    #                 (pending) rather than blocking the user.
    # Pass the user's OTP-verified phone + (optional) email so the
    # sole-prop fallback can match against MISPAR_TEL / EMAIL when the
    # registry has an empty MISPAR_YESHUT.
    kablan_check = await verification.verify_kablan_match(
        data.business_number, data.kablan_number,
        owner_phone=data.contact_phone,
        owner_email=data.contact_email,
    )
    kablan_matched = bool(kablan_check.get("match"))

    # Snapshot the registry row + extracted fields for the contractors
    # insert. Either path A (lookup-by-ח.פ) or path B (lookup-by-kablan)
    # may have produced these; the helper threads them through so we
    # don't have to know which one matched.
    pinkash_row    = kablan_check.get("pinkash_row")
    pinkash_fields = kablan_check.get("pinkash_fields") or {}
    now = datetime.utcnow()

    org_id = str(uuid.uuid4())
    sla_deadline = now + timedelta(hours=48)

    # Tier + approval state are driven by the kablan match:
    #   match  → tier_2, approved, verification_method='kablan_match'
    #   no     → keep the initial_tier from registry presence, stay
    #            pending for admin review (default approval_status).
    final_tier = "tier_2" if kablan_matched else initial_tier
    verification_method = "kablan_match" if kablan_matched else "none"
    verified_at = now if kablan_matched else None
    kablan_verified_at = now if kablan_matched else None
    revalidate_at = (now + verification.REVALIDATE_PERIOD) if kablan_matched else None
    approval_status = "approved" if kablan_matched else "pending"
    approved_at = now if kablan_matched else None

    conn = get_db()
    try:
        cur = conn.cursor()
        # Prefer the pinkash snapshot from the kablan check (covers both
        # path A and path B) over the original quick_lookup prefill —
        # path B kicks in for sole props whose ח.פ isn't in the dataset,
        # so quick_lookup's prefill is empty in that case.
        snapshot_kvutza     = pinkash_fields.get("kvutza")     or prefill.get("kvutza")
        snapshot_sivug      = pinkash_fields.get("sivug")      or prefill.get("sivug")
        snapshot_branch     = pinkash_fields.get("gov_branch") or prefill.get("gov_branch")

        cur.execute(
            """INSERT INTO contractors
               (id, user_owner_id, company_name, company_name_he, business_number,
                kablan_number, kvutza, sivug, gov_branch, gov_company_status,
                operating_regions, contact_name, contact_phone, contact_email,
                verification_tier, verification_method, verified_at,
                kablan_verified_at,
                gov_registry_snapshot, gov_registry_fetched_at,
                registry_email, registry_phone, registry_address,
                license_issued_at, registry_kablan_mukar, registry_annual_scope,
                revalidate_at,
                approval_status, approved_at, approval_sla_deadline)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                       %s, %s,
                       %s, %s, %s,
                       %s, %s, %s,
                       %s, %s, %s, %s)""",
            (org_id, "PENDING", company_name, company_name_he,
             data.business_number,
             # Always store what the USER TYPED, not the registry value.
             # On match these are equal modulo formatting; on mismatch
             # the admin queue surfaces both for comparison.
             data.kablan_number.strip(),
             snapshot_kvutza,
             snapshot_sivug,
             snapshot_branch,
             lookup.get("gov_company_status"),
             json.dumps(data.operating_regions), data.contact_name,
             data.contact_phone, data.contact_email,
             final_tier, verification_method, verified_at,
             kablan_verified_at,
             # Registry snapshot (NULL when no pinkash row was found).
             json.dumps(pinkash_row, ensure_ascii=False) if pinkash_row else None,
             now if pinkash_row else None,
             pinkash_fields.get("email"),
             pinkash_fields.get("phone"),
             pinkash_fields.get("address"),
             pinkash_fields.get("license_issued_at"),
             pinkash_fields.get("kablan_mukar"),
             pinkash_fields.get("annual_scope"),
             revalidate_at,
             approval_status, approved_at, sla_deadline)
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
            # 'approved' when kablan matched + auto-promoted; 'pending'
            # when we need an admin to review the mismatch.
            "status":              approval_status,
            "org_type":            "contractor",
            "verification_tier":   final_tier,
            "registry_found":      lookup.get("pinkash_found", False),
            "kablan_matched":      kablan_matched,
            # available_channels stays for the legacy email/SMS flow —
            # if kablan matched we don't NEED it, but exposing it lets
            # the contractor optionally also verify via a contact
            # channel for the audit trail.
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


@router.post("/{org_id}/verify-kablan")
async def verify_kablan(
    org_id: str,
    data: VerifyKablan,
    x_user_id:   Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Backfill flow — existing contractors who registered before the
    kablan match was required (or whose first attempt mismatched and
    they're back to retry with the correct number) submit their
    kablan_number here.

    Behaviour mirrors registration's match logic:
      - match  → bump to tier_2 via kablan_match_approve()
      - no     → store the typed value, stay pending, return mismatch
                 so the UI can prompt the user to contact support.
      - lookup unreachable → treat as mismatch (no upgrade) but with
                 reason='registry_unreachable' so the UI can offer
                 'try again later'.

    Auth: requires that the caller is owner/admin of THIS contractor
    (platform admin can call from anywhere). Same role gate as the
    PATCH /users endpoint."""
    conn = get_db()
    try:
        cur = conn.cursor()
        # Confirm the contractor exists + grab business_number + contact
        # info for the lookup. Phone + email are needed for the sole-
        # prop fallback in verify_kablan_match.
        cur.execute(
            """SELECT business_number, contact_phone, contact_email,
                      kablan_verified_at
                 FROM contractors
                WHERE id = %s AND deleted_at IS NULL""",
            (org_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="contractor_not_found")
        business_number = row["business_number"]
        contact_phone   = row.get("contact_phone")
        contact_email   = row.get("contact_email")

        # Role gate (skip if platform admin)
        if x_user_role != "admin":
            if not x_user_id:
                raise HTTPException(status_code=401, detail="auth_required")
            cur.execute(
                """SELECT role FROM auth_db.entity_memberships
                   WHERE entity_type='contractor' AND entity_id=%s
                     AND user_id=%s AND is_active=TRUE LIMIT 1""",
                (org_id, x_user_id),
            )
            mem = cur.fetchone()
            if not mem or mem["role"] not in ("owner", "admin"):
                raise HTTPException(
                    status_code=403,
                    detail={
                        "code":    "forbidden_kablan_verify",
                        "message": "רק בעלים או מנהל של הקבלן רשאי לאמת מספר רישיון.",
                    },
                )
    finally:
        conn.close()

    check = await verification.verify_kablan_match(
        business_number, data.kablan_number,
        owner_phone=contact_phone, owner_email=contact_email,
    )
    matched = bool(check.get("match"))

    # Always store the typed value so admin/support can see what the
    # contractor claimed even on a mismatch. If the verifier located a
    # pinkash row (path A or B), also refresh the registry snapshot
    # columns — useful even on a mismatch because admin can review the
    # row that almost matched.
    pinkash_row    = check.get("pinkash_row")
    pinkash_fields = check.get("pinkash_fields") or {}
    conn = get_db()
    try:
        cur = conn.cursor()
        if pinkash_row:
            cur.execute(
                """UPDATE contractors
                      SET kablan_number          = %s,
                          gov_registry_snapshot  = %s,
                          gov_registry_fetched_at= NOW(),
                          registry_email         = %s,
                          registry_phone         = %s,
                          registry_address       = %s,
                          license_issued_at      = %s,
                          registry_kablan_mukar  = %s,
                          registry_annual_scope  = %s,
                          kvutza                 = COALESCE(%s, kvutza),
                          sivug                  = COALESCE(%s, sivug),
                          gov_branch             = COALESCE(%s, gov_branch)
                    WHERE id = %s""",
                (data.kablan_number.strip(),
                 json.dumps(pinkash_row, ensure_ascii=False),
                 pinkash_fields.get("email"),
                 pinkash_fields.get("phone"),
                 pinkash_fields.get("address"),
                 pinkash_fields.get("license_issued_at"),
                 pinkash_fields.get("kablan_mukar"),
                 pinkash_fields.get("annual_scope"),
                 pinkash_fields.get("kvutza"),
                 pinkash_fields.get("sivug"),
                 pinkash_fields.get("gov_branch"),
                 org_id),
            )
        else:
            cur.execute(
                "UPDATE contractors SET kablan_number=%s WHERE id=%s",
                (data.kablan_number.strip(), org_id),
            )
        conn.commit()
    finally:
        conn.close()

    if matched:
        result = verification.kablan_match_approve(org_id)
        # Fire the same success event the email/SMS path fires so the
        # contractor gets the standard "you're verified" SMS/email.
        conn = get_db()
        try:
            cur = conn.cursor()
            cur.execute(
                """SELECT contact_name, contact_email, contact_phone, company_name_he
                   FROM contractors WHERE id=%s""",
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
            "verification_method": "kablan_match",
        })
        return {"ok": True, "matched": True, "tier": result["tier"]}

    # Mismatch (or registry unreachable). Keep the row pending; the
    # admin queue already lists it. Surface the reason to the UI so
    # the user gets the right message ("we'll review" vs "try again").
    return {
        "ok": True,
        "matched": False,
        "reason": check.get("reason") or "kablan_mismatch",
    }


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
                      em.is_active, em.is_deal_contact, em.invitation_accepted_at,
                      em.created_at,
                      em.invited_first_name, em.invited_last_name,
                      COALESCE(u.phone, em.invited_phone) AS phone,
                      u.full_name, u.email
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
            # When the user hasn't accepted yet, surface the inviter-
            # provided name so the team UI doesn't show "—".
            if not r.get("full_name") and (r.get("invited_first_name") or r.get("invited_last_name")):
                r["full_name"] = f"{r.get('invited_first_name','') or ''} {r.get('invited_last_name','') or ''}".strip()
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

        # Normalise phone for the SMS payload (best-effort; auth will normalise properly on accept)
        raw_phone = data.phone.strip()

        # Create pending membership (no user_id yet — filled on acceptance)
        cur.execute(
            """INSERT INTO auth_db.entity_memberships
               (membership_id, user_id, entity_type, entity_id, role, job_title,
                invited_first_name, invited_last_name, invited_phone,
                invited_by, invitation_token, is_active)
               VALUES (%s, NULL, 'contractor', %s, %s, %s, %s, %s, %s, %s, %s, FALSE)""",
            (membership_id,
             org_id, data.role, data.job_title,
             (data.first_name or '').strip() or None,
             (data.last_name  or '').strip() or None,
             raw_phone or None,
             inviter_user_id, invite_token)
        )
        conn.commit()

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


@router.delete("/{org_id}/users/{membership_id}", status_code=204)
def delete_contractor_user(
    org_id: str,
    membership_id: str,
    x_user_id:   Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Same as the corp delete endpoint. Hard delete + recipient cleanup."""
    team_mgmt.delete_membership(
        entity_type="contractor",
        entity_id=org_id,
        membership_id=membership_id,
        caller_user_id=x_user_id,
        caller_role=x_user_role,
    )


class TeamMemberPatch(BaseModel):
    role:               Optional[str] = None
    job_title:          Optional[str] = None
    invited_first_name: Optional[str] = None
    invited_last_name:  Optional[str] = None
    invited_phone:      Optional[str] = None


@router.patch("/{org_id}/users/{membership_id}")
async def update_contractor_user(
    org_id: str,
    membership_id: str,
    data: TeamMemberPatch,
    x_user_id:   Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Mirror of the corp PATCH endpoint."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT company_name_he FROM contractors WHERE id = %s AND deleted_at IS NULL",
            (org_id,),
        )
        org = cur.fetchone()
    finally:
        conn.close()
    if not org:
        raise HTTPException(status_code=404, detail="Contractor not found")

    return await team_mgmt.update_membership(
        entity_type="contractor",
        entity_id=org_id,
        membership_id=membership_id,
        patch=data.dict(exclude_unset=True),
        caller_user_id=x_user_id,
        caller_role=x_user_role,
        entity_name=org.get("company_name_he"),
    )


# ── Deal contacts (per-membership flag) ───────────────────────────────
class ContractorDealContactPatch(BaseModel):
    is_deal_contact: bool


@router.patch("/{org_id}/users/{membership_id}/deal-contact")
def set_contractor_deal_contact(
    org_id: str,
    membership_id: str,
    data: ContractorDealContactPatch,
    x_user_id:   Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    return team_mgmt.set_deal_contact(
        entity_type="contractor",
        entity_id=org_id,
        membership_id=membership_id,
        is_deal_contact=data.is_deal_contact,
        caller_user_id=x_user_id,
        caller_role=x_user_role,
    )


@router.get("/{org_id}/deal-contacts")
def list_contractor_deal_contacts(org_id: str):
    """Return active deal-contact members for a contractor entity.
    Used by the corp deal page to show "who at the contractor to call"."""
    return team_mgmt.list_deal_contacts("contractor", org_id)


# ── Notification recipients ──────────────────────────────────────────
@router.get("/{org_id}/notification-recipients")
def list_contractor_notification_recipients(org_id: str):
    return notif_recipients.list_recipients("contractor", org_id)


@router.put("/{org_id}/notification-recipients/{user_id}")
def upsert_contractor_notification_recipient(
    org_id: str,
    user_id: str,
    body: notif_recipients.RecipientUpsert,
    x_user_id:   Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    return notif_recipients.upsert_recipient(
        entity_type="contractor",
        entity_id=org_id,
        target_user_id=user_id,
        body=body,
        caller_user_id=x_user_id,
        caller_role=x_user_role,
    )


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
