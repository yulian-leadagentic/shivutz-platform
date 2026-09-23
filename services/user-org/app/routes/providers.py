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

  3. Register-time `marketplace_subscriptions` row (R10 §1). The
     provider picks a paid tier for their `primary_category` at
     signup; the row is snapshotted here (slot_count, duration_days,
     price_nis all frozen) so admin tier edits later don't
     retroactively change what this provider bought.
     R10 §2 · when site_settings.launch_promo_end is in the future
     the row is written with price_paid=0 + promo_note+expires_at=
     launch_promo_end (the real tier price still shows in
     price_nis as the anchor — displaying "free" alone would collapse
     price memory). Once launch_promo_end passes, new signups get
     the standard price/expires_at pair.

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
from app.services.phone_normalize import normalize_or_400

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
    # R10 §1 · tier the provider chose from the plan picker (the paid
    # tiers for `primary_category`, excluding any price_nis=0 admin
    # slots — the picker filters those out). Snapshotted onto
    # marketplace_subscriptions so an admin tier edit later doesn't
    # retroactively change what this provider bought.
    subscription_tier_id: str
    # R10 §5 · email required. Yulian's decisions doc §5 upgraded it
    # from optional so the welcome email actually has a destination.
    # EmailStr validates syntax; the send layer's allowlist gates
    # domain (staging: @example.com and @tagidai.com only).
    email: EmailStr
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
    # R26 §2c v2 · same safe whitespace normalisation contractors +
    # corporations got. Trim + collapse double spaces; NO reject
    # regex. Providers store their business name in `name` (not
    # company_name_he), but the same "missing space before suffix"
    # typo shape applies.
    name = " ".join(((data.name or "").strip() or data.contact_name.strip()).split()).strip()
    if not name:
        raise HTTPException(status_code=400, detail="name_required")
    # R30 §15 · was a bare .strip() emptiness check, so any string of
    # any shape became this provider's SMS login identity. Normalize
    # to the canonical form and reject anything that isn't an Israeli
    # mobile; `data.contact_phone` is reassigned so every downstream
    # use (the duplicate check at :261, the INSERT, the auth user row)
    # sees the same canonical value.
    data.contact_phone = normalize_or_400(data.contact_phone)

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

        # R10 §1 · validate subscription_tier_id BEFORE any writes.
        # Must belong to primary_category, is_active, and price_nis > 0
        # (price_nis=0 tiers are admin-only overrides; the picker
        # doesn't show them so a client can't request one).
        cur.execute(
            """SELECT id, category_code, name_he, slot_count, duration_days,
                      price_nis, is_active
                 FROM marketplace_subscription_tiers WHERE id = %s""",
            (data.subscription_tier_id,),
        )
        tier = cur.fetchone()
        if not tier:
            raise HTTPException(status_code=400, detail={
                "code":    "unknown_tier",
                "message": "המסלול שנבחר אינו זמין",
            })
        if not tier["is_active"]:
            raise HTTPException(status_code=410, detail={
                "code":    "tier_inactive",
                "message": "המסלול שנבחר אינו פעיל יותר",
            })
        if tier["category_code"] != cat:
            raise HTTPException(status_code=400, detail={
                "code":    "tier_category_mismatch",
                "message": "המסלול לא תואם לקטגוריה שנבחרה",
            })
        if not tier["price_nis"] or float(tier["price_nis"]) <= 0:
            raise HTTPException(status_code=400, detail={
                "code":    "tier_price_invalid",
                "message": "לא ניתן להירשם למסלול בעלות 0",
            })

        # R10 §2 · look up the launch promo end date from
        # site_settings so the INSERT below can decide between
        # promo-priced (price_paid=0 + promo_note + expires_at=
        # launch_promo_end) and full-price paths. Missing/malformed
        # value → no promo applies (fail closed on the "we're giving
        # away free service" side).
        cur.execute(
            "SELECT setting_val FROM site_settings WHERE setting_key='launch_promo_end' LIMIT 1"
        )
        promo_row = cur.fetchone()
        promo_end = None
        if promo_row and promo_row.get("setting_val"):
            try:
                promo_end = datetime.strptime(
                    promo_row["setting_val"], "%Y-%m-%d"
                )
            except (ValueError, TypeError):
                promo_end = None
        promo_active = promo_end is not None and promo_end > datetime.utcnow()
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

        # R10 §1 + §2 · marketplace_subscriptions row for the picked
        # tier. Under the launch promo (until site_settings.
        # launch_promo_end) the row records price_paid=0 +
        # promo_note='launch_free_promo' and rides the promo_end
        # date; the real tier price stays visible in price_nis (the
        # snapshot column) so we can audit "what was the sticker
        # price at the time" a year from now. After the promo the
        # row uses the full tier price + DATE_ADD(NOW, duration_days).
        #
        # Duration under promo can far exceed tier.duration_days —
        # e.g. a 30-day tier picked in October runs until 31.12 for
        # free. The renewal batch sees expires_at as the ONLY
        # authority for when the sub lapses, so this is intentional.
        sub_id = str(uuid.uuid4())
        if promo_active:
            cur.execute(
                """INSERT INTO marketplace_subscriptions
                       (id, advertiser_entity_type, advertiser_entity_id,
                        category_code, tier_id, slot_count, duration_days,
                        price_nis, promo_note,
                        expires_at, auto_renew, status, cardcom_token_ref)
                   VALUES (%s, 'service_provider', %s, %s, %s, %s, %s,
                           %s, 'launch_free_promo',
                           %s, TRUE, 'active', NULL)""",
                (
                    sub_id, provider_id,
                    cat, tier["id"], tier["slot_count"], tier["duration_days"],
                    tier["price_nis"], promo_end,
                ),
            )
        else:
            cur.execute(
                """INSERT INTO marketplace_subscriptions
                       (id, advertiser_entity_type, advertiser_entity_id,
                        category_code, tier_id, slot_count, duration_days,
                        price_nis, promo_note,
                        expires_at, auto_renew, status, cardcom_token_ref)
                   VALUES (%s, 'service_provider', %s, %s, %s, %s, %s,
                           %s, NULL,
                           DATE_ADD(NOW(), INTERVAL %s DAY),
                           TRUE, 'active', NULL)""",
                (
                    sub_id, provider_id,
                    cat, tier["id"], tier["slot_count"], tier["duration_days"],
                    tier["price_nis"],
                    tier["duration_days"],
                ),
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
        plan_name = tier.get("name_he") or "מסלול בסיסי"
        await publish_event("org.activated", {
            "org_id":         provider_id,
            "org_name":       name,
            "org_type":       "service_provider",
            "category_code":  cat,
            "category_name":  category_name,
            "plan_name":      plan_name,
        })

        # R10 §5 · welcome email to the provider themselves. Different
        # event key (provider.welcome) with its own template (091);
        # handlers.js sends to `data.email` only, not the admins.
        # {promo_block} is computed in the handler because it depends
        # on site_settings.launch_promo_end at send time — sending a
        # promo blurb whose date already passed would be worse than
        # sending none.
        # R17 §1 · Default matches the other three services (admin,
        # user-org/contractors, notification) — 'https://www.tagidai.com'.
        # The previous default here was 'https://staging.buildupai.net',
        # a legacy staging subdomain on the abandoned domain — the R10
        # §6 welcome-email `cta_url` was built from it, so any prod
        # deploy that missed setting FRONTEND_URL would land the paying
        # provider on a dead domain. Same wording as handlers.js:10
        # which flagged the risk explicitly.
        frontend_url = os.getenv("FRONTEND_URL", "https://www.tagidai.com")
        cta_url = f"{frontend_url}/provider/marketplace/new?category={cat}"
        await publish_event("provider.welcome", {
            "recipient_email": data.email,
            "contact_name":    data.contact_name,
            "business_name":   name,
            "plan_name":       plan_name,
            "category_name":   category_name,
            "category_code":   cat,
            "cta_url":         cta_url,
            # promo_end_iso lets the handler decide whether to render
            # the "free until X" block without another DB round-trip.
            # ISO date so downstream comparison is unambiguous;
            # `null` means "no promo active" and the block collapses.
            "promo_end_iso":   promo_end.strftime("%Y-%m-%d") if promo_active else None,
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
