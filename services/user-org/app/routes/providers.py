"""U7 · service provider self-registration.

Providers are the third entity type on the marketplace, added by
migration 077. They differ from contractor / corporation in three
important ways:

  1. Single-owner. There is no team-invite flow — one contact_phone,
     one owner. auth.js /invite/accept explicitly rejects a provider
     membership row (defensive, providers shouldn't hit that path).

  2. Auto-approved. No גוב-list cross-check, no admin queue. The row
     lands with status='active' and can publish immediately. The trust
     badge on their listings is derived from `status` at read time.

  3. Free. No `marketplace_subscriptions` row is created here. The
     POST /marketplace endpoint has a `service_provider` bypass that
     skips the subscription/slot check the way corp+housing does.
     So there's no tier / category / expiry to seed at registration.

Duplicate business_number → 409 (same shape as corporation).
Duplicate contact_phone with an active provider → 409.
"""
from datetime import datetime
from typing import Optional
import json
import os
import uuid

import httpx
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, EmailStr

from app.db import get_db
from app.publisher import publish_event

router = APIRouter()
AUTH_SERVICE = os.getenv("AUTH_SERVICE_URL", "http://auth:3001")


class ProviderCreate(BaseModel):
    name: str                            # display name (falls back to contact_name if empty)
    contact_name: str                    # owner full name (also used as user.full_name)
    contact_phone: str                   # owner mobile (used as user.phone for SMS login)
    # R5 §2a · ח.פ / ע.מ was optional pre-17.09; Yulian promoted it to
    # required. Format-only check (9 digits) — providers aren't in
    # ראשם החברות so we deliberately DON'T lookup like corporations do.
    business_number: str
    # R5 §2b · trade the provider self-selected at signup. Validated
    # against the live marketplace_categories table below so a stale
    # client can't seed a bogus code. Association only — the provider
    # can still publish listings in other categories.
    primary_category: str
    email: Optional[EmailStr] = None
    city: Optional[str] = None
    region: Optional[str] = None
    website: Optional[str] = None
    description: Optional[str] = None
    logo_url: Optional[str] = None       # Cloudinary URL if the user uploaded one
    whatsapp_opt_in: Optional[bool] = False


@router.post("/register", status_code=201)
async def register_provider(data: ProviderCreate):
    """Create a provider row + auth user + membership, all auto-active.

    OTP was verified in a preceding /auth/register-otp step (same
    contract corporations use). Auth service `POST /auth/register`
    guards on `check-recent-otp` internally — no direct OTP check here.
    """
    name = (data.name or "").strip() or data.contact_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name_required")
    if not data.contact_phone.strip():
        raise HTTPException(status_code=400, detail="contact_phone_required")

    # R5 §2a · format-only ח.פ check (9 digits). No registry lookup —
    # provider is deliberately outside the corp registry (that's why the
    # entity type exists in the first place).
    bn = (data.business_number or "").strip()
    if not bn:
        raise HTTPException(status_code=400, detail={
            "code":    "business_number_required",
            "message": "ח.פ / ע.מ הוא שדה חובה",
        })
    if not bn.isdigit() or len(bn) != 9:
        raise HTTPException(status_code=400, detail={
            "code":    "invalid_business_number",
            "message": "ח.פ / ע.מ חייב להיות 9 ספרות",
        })

    # R5 §2b · primary_category must be an active marketplace_category.
    # Validated live so an admin renaming the category set can't leave
    # a stale client seeding an orphan code.
    cat = (data.primary_category or "").strip()
    if not cat:
        raise HTTPException(status_code=400, detail={
            "code":    "primary_category_required",
            "message": "יש לבחור קטגוריה",
        })

    # ── Duplicate business_number guard — checks ALL three entity
    # types, not just service_providers. A ח.פ that's registered as a
    # corporation or contractor should redirect the user to log in
    # with the right role instead of creating a parallel provider
    # profile (R5 §2a · "הודעה ברורה + הפניה לכניסה, לא 500").
    conn = get_db()
    try:
        cur = conn.cursor()
        # Live-validate category before we do any writes.
        cur.execute(
            """SELECT 1 FROM marketplace_categories
                WHERE code = %s AND is_active = 1 LIMIT 1""",
            (cat,),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=400, detail={
                "code":    "unknown_category",
                "message": "הקטגוריה שנבחרה אינה זמינה",
            })
        cur.execute(
            """SELECT id, name FROM service_providers
                WHERE business_number = %s
                  AND deleted_at IS NULL
                LIMIT 1""",
            (bn,),
        )
        existing = cur.fetchone()
        if existing:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "provider_already_registered",
                    "message": (
                        "ספק שירות עם ח.פ זה כבר רשום במערכת. "
                        "אנא היכנס במקום להירשם."
                    ),
                    "existing_name": existing.get("name"),
                },
            )
        # Same ח.פ registered as contractor?
        cur.execute(
            "SELECT id, company_name_he FROM contractors "
            "WHERE business_number = %s AND deleted_at IS NULL LIMIT 1",
            (bn,),
        )
        c_existing = cur.fetchone()
        if c_existing:
            raise HTTPException(status_code=409, detail={
                "code":    "business_number_registered_as_contractor",
                "message": (
                    "ח.פ זה כבר רשום כקבלן במערכת. אנא היכנס לחשבון "
                    "הקבלן שלך במקום להירשם כספק."
                ),
                "existing_name": c_existing.get("company_name_he"),
            })
        # Same ח.פ registered as corporation?
        cur.execute(
            "SELECT id, company_name_he FROM corporations "
            "WHERE business_number = %s AND deleted_at IS NULL LIMIT 1",
            (bn,),
        )
        corp_existing = cur.fetchone()
        if corp_existing:
            raise HTTPException(status_code=409, detail={
                "code":    "business_number_registered_as_corporation",
                "message": (
                    "ח.פ זה כבר רשום כתאגיד במערכת. אנא היכנס לחשבון "
                    "התאגיד שלך במקום להירשם כספק."
                ),
                "existing_name": corp_existing.get("company_name_he"),
            })

        # Duplicate phone → block. Providers are single-owner; if the
        # same phone already owns an active provider, this is a re-reg
        # attempt (there's no team-add flow to fall through to).
        cur.execute(
            """SELECT sp.id
                 FROM service_providers sp
                 JOIN auth_db.entity_memberships em
                   ON em.entity_id = sp.id
                  AND em.entity_type = 'service_provider'
                  AND em.is_active = TRUE
                 JOIN auth_db.users u ON u.id = em.user_id
                WHERE u.phone = %s
                  AND sp.deleted_at IS NULL
                LIMIT 1""",
            (data.contact_phone,),
        )
        if cur.fetchone():
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "phone_already_provider",
                    "message": (
                        "מספר טלפון זה כבר רשום כספק שירות. "
                        "אנא היכנס במקום להירשם."
                    ),
                },
            )

        # ── Insert provider row ────────────────────────────────────
        provider_id = str(uuid.uuid4())
        now = datetime.utcnow()
        cur.execute(
            """INSERT INTO service_providers
                 (id, name, business_number, primary_category,
                  contact_name, contact_phone,
                  email, city, region, website, description, logo_url,
                  status, verified_at, is_seed, created_at, updated_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                       'active', %s, FALSE, %s, %s)""",
            (
                provider_id, name, bn, cat,
                data.contact_name.strip(), data.contact_phone.strip(),
                data.email, data.city, data.region, data.website,
                data.description, data.logo_url,
                now, now, now,
            ),
        )

        # ── Auth user (phone-first, OTP pre-verified upstream) ────
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{AUTH_SERVICE}/auth/register",
                json={
                    "phone":           data.contact_phone,
                    "full_name":       data.contact_name,
                    "role":            "service_provider",  # migration 077 added this to users.role enum
                    "org_id":          provider_id,
                    "org_type":        "service_provider",
                    "include_tokens":  True,
                    "whatsapp_opt_in": bool(data.whatsapp_opt_in),
                },
            )
            if resp.status_code == 409:
                conn.rollback()
                raise HTTPException(status_code=409, detail="Phone already registered")
            if resp.status_code == 400:
                conn.rollback()
                body = resp.json()
                raise HTTPException(status_code=400, detail=body.get("error", "registration_failed"))
            resp.raise_for_status()
            user = resp.json()

        # ── Membership row (single owner, no team invites) ────────
        cur.execute(
            """INSERT INTO auth_db.entity_memberships
                 (membership_id, user_id, entity_type, entity_id, role,
                  invitation_accepted_at, is_active)
               VALUES (%s, %s, 'service_provider', %s, 'owner', NOW(), TRUE)""",
            (str(uuid.uuid4()), user["id"], provider_id),
        )
        conn.commit()

        # R10 §3 · providers auto-activate (status='active' at :211),
        # so "pending approval" is the wrong story to tell an admin —
        # the notification has to say "just activated, FYI" without
        # approve/reject buttons that would do nothing. New event
        # `org.activated` is the informational counterpart to
        # `org.registered`; handlers.js dispatches it to a separate
        # SMS/email template with no CTA.
        #
        # Category display name looked up here (cheap, on the same
        # connection) so the notification service doesn't need to
        # reach back into org_db just to render one string.
        cur.execute(
            "SELECT name_he FROM marketplace_categories WHERE code=%s AND is_active=TRUE",
            (cat,),
        )
        cat_row = cur.fetchone()
        category_name = cat_row["name_he"] if cat_row and cat_row.get("name_he") else cat
        await publish_event("org.activated", {
            "org_id":         provider_id,
            "org_name":       name,
            "org_type":       "service_provider",
            "category_code":  cat,
            "category_name":  category_name,
        })

        return {
            "id":            provider_id,
            "name":          name,
            "status":        "active",
            "org_type":      "service_provider",
            "access_token":  user.get("access_token"),
            "refresh_token": user.get("refresh_token"),
        }
    finally:
        conn.close()


@router.get("/me")
def get_my_provider(
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    """Return the caller's provider record (dashboard header + settings)."""
    if x_entity_type != "service_provider" or not x_entity_id:
        raise HTTPException(status_code=403, detail="provider_only")

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT id, name, business_number, primary_category,
                      contact_name, contact_phone,
                      email, city, region, website, description, logo_url,
                      status, verified_at, created_at
                 FROM service_providers
                WHERE id = %s AND deleted_at IS NULL
                LIMIT 1""",
            (x_entity_id,),
        )
        row = cur.fetchone()
    finally:
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="provider_not_found")
    return row
