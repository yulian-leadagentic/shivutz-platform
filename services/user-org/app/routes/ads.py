"""Pivot/v2 Phase 2 — corporation worker/housing ads.

Corp-owner CRUD on the `ads` table. Read-only public discovery comes
in Phase 3 (free-text search). For now, only the entity that owns the
ad can see/edit it.

Phase 2 ships WORKER ads only on the UI side; the schema already has
housing columns so Phase 4 doesn't need a migration.

Boost: marks an ad as featured_until = now + 7 days. Real promotion
billing lands in Phase 5 — for now `boost` is free and just flips
the column.
"""
import json
import os
import uuid
from datetime import datetime, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.db import get_db
from app.services.subscription_limits import fetch_entitlement, tier_limits

router = APIRouter()

PAYMENT_SVC = os.getenv("PAYMENT_SERVICE_URL", "http://payment:3009")

AD_DEFAULT_DAYS = 30
BOOST_DAYS      = 7


def _serialize(row: dict) -> dict:
    out = dict(row)
    for k, v in list(out.items()):
        if isinstance(v, datetime):
            out[k] = v.isoformat()
        if k in ("languages", "amenities", "photos") and isinstance(v, str):
            try:
                out[k] = json.loads(v)
            except Exception:
                pass
    return out


def _require_corp(x_entity_id: Optional[str], x_entity_type: Optional[str]) -> str:
    if not x_entity_id:
        raise HTTPException(status_code=401, detail="no_entity_context")
    if x_entity_type != "corporation":
        raise HTTPException(status_code=403, detail="corp_only")
    return x_entity_id


# ─── Pydantic ───────────────────────────────────────────────────────────────

class AdIn(BaseModel):
    ad_type: str  # 'worker' | 'housing'
    title_he: str = Field(..., min_length=2, max_length=255)
    body_he:  Optional[str] = None

    # Worker fields
    profession_code:       Optional[str]      = None
    origin_country:        Optional[str]      = None
    region:                Optional[str]      = None
    quantity:              Optional[int]      = None
    experience_min_months: Optional[int]      = None
    visa_valid_until:      Optional[str]      = None  # YYYY-MM-DD
    languages:             Optional[list[str]] = None

    # Housing fields (Phase 4 — accepted but UI doesn't post them yet)
    city:              Optional[str]       = None
    address_he:        Optional[str]       = None
    total_beds:        Optional[int]       = None
    available_beds:    Optional[int]       = None
    price_per_bed_nis: Optional[int]       = None
    amenities:         Optional[list[str]] = None
    photos:            Optional[list[str]] = None

    # Lifecycle
    expires_at: Optional[str] = None  # ISO; defaults to now + AD_DEFAULT_DAYS


class AdPatch(BaseModel):
    title_he:              Optional[str]       = None
    body_he:               Optional[str]       = None
    profession_code:       Optional[str]       = None
    origin_country:        Optional[str]       = None
    region:                Optional[str]       = None
    quantity:              Optional[int]       = None
    experience_min_months: Optional[int]       = None
    visa_valid_until:      Optional[str]       = None
    languages:             Optional[list[str]] = None
    city:                  Optional[str]       = None
    address_he:            Optional[str]       = None
    total_beds:            Optional[int]       = None
    available_beds:        Optional[int]       = None
    price_per_bed_nis:     Optional[int]       = None
    amenities:             Optional[list[str]] = None
    photos:                Optional[list[str]] = None
    active:                Optional[bool]      = None
    expires_at:            Optional[str]       = None


# ─── POST /ads ──────────────────────────────────────────────────────────────

@router.post("", status_code=201)
def create_ad(
    body: AdIn,
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    corp_id = _require_corp(x_entity_id, x_entity_type)
    if body.ad_type not in ("worker", "housing"):
        raise HTTPException(status_code=400, detail="invalid_ad_type")

    # Tier-cap active-ad count. Phase 5 gate — see subscription_limits.
    try:
        ent = fetch_entitlement(corp_id, "corporation")
    except httpx.HTTPError:
        # Payment down — fail closed but with a clearer error than 500.
        raise HTTPException(status_code=503, detail="entitlement_service_unreachable")
    if not ent["entitled"]:
        raise HTTPException(status_code=402, detail={"code": "subscription_required", "tier": ent["tier"], "status": ent["status"]})
    limits = tier_limits(ent["tier"])
    if limits["active_ads"] is not None:
        _conn = get_db()
        try:
            _cur = _conn.cursor()
            _cur.execute(
                "SELECT COUNT(*) AS n FROM ads WHERE owner_entity_id=%s AND deleted_at IS NULL AND active=TRUE",
                (corp_id,),
            )
            row = _cur.fetchone()
            n = int(row["n"] if row else 0)
        finally:
            _conn.close()
        if n >= limits["active_ads"]:
            raise HTTPException(status_code=402, detail={
                "code":  "tier_active_ad_limit",
                "tier":  ent["tier"],
                "limit": limits["active_ads"],
                "used":  n,
            })

    ad_id = str(uuid.uuid4())
    expires_at = body.expires_at or (datetime.utcnow() + timedelta(days=AD_DEFAULT_DAYS)).isoformat()

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO ads
                 (id, owner_entity_id, owner_entity_type, ad_type,
                  title_he, body_he,
                  profession_code, origin_country, region, quantity,
                  experience_min_months, visa_valid_until, languages,
                  city, address_he, total_beds, available_beds,
                  price_per_bed_nis, amenities, photos,
                  expires_at)
               VALUES (%s, %s, 'corporation', %s,
                       %s, %s,
                       %s, %s, %s, %s,
                       %s, %s, %s,
                       %s, %s, %s, %s,
                       %s, %s, %s,
                       %s)""",
            (
                ad_id, corp_id, body.ad_type,
                body.title_he, body.body_he,
                body.profession_code, body.origin_country, body.region, body.quantity,
                body.experience_min_months, body.visa_valid_until,
                json.dumps(body.languages, ensure_ascii=False) if body.languages else None,
                body.city, body.address_he, body.total_beds, body.available_beds,
                body.price_per_bed_nis,
                json.dumps(body.amenities, ensure_ascii=False) if body.amenities else None,
                json.dumps(body.photos, ensure_ascii=False) if body.photos else None,
                expires_at,
            ),
        )
        conn.commit()
        cur.execute("SELECT * FROM ads WHERE id=%s", (ad_id,))
        return _serialize(cur.fetchone())
    finally:
        conn.close()


# ─── GET /ads/usage — current caller's tier + counters (Phase 5) ────────────

@router.get("/usage")
def usage(
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    if not x_entity_id or not x_entity_type:
        raise HTTPException(status_code=401, detail="auth_required")
    try:
        ent = fetch_entitlement(x_entity_id, x_entity_type)
    except httpx.HTTPError:
        raise HTTPException(status_code=503, detail="entitlement_service_unreachable")
    limits = tier_limits(ent["tier"])

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT COUNT(*) AS n FROM contact_reveals
                WHERE viewer_entity_id=%s AND viewer_entity_type=%s
                  AND revealed_at >= DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00')""",
            (x_entity_id, x_entity_type),
        )
        reveals_used = int(cur.fetchone()["n"])
        active_ads_used = 0
        if x_entity_type == "corporation":
            cur.execute(
                "SELECT COUNT(*) AS n FROM ads WHERE owner_entity_id=%s AND deleted_at IS NULL AND active=TRUE",
                (x_entity_id,),
            )
            active_ads_used = int(cur.fetchone()["n"])
    finally:
        conn.close()

    return {
        "tier":     ent["tier"],
        "status":   ent["status"],
        "entitled": ent["entitled"],
        "limits":   limits,
        "usage": {
            "reveals_this_month": reveals_used,
            "active_ads":         active_ads_used,
        },
    }


# ─── GET /ads/mine ──────────────────────────────────────────────────────────

@router.get("/mine")
def list_my_ads(
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    corp_id = _require_corp(x_entity_id, x_entity_type)
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT * FROM ads
                WHERE owner_entity_id=%s AND deleted_at IS NULL
                ORDER BY featured_until DESC, created_at DESC""",
            (corp_id,),
        )
        return [_serialize(r) for r in cur.fetchall()]
    finally:
        conn.close()


def _fetch_owned(cur, ad_id: str, corp_id: str) -> dict:
    cur.execute(
        "SELECT * FROM ads WHERE id=%s AND owner_entity_id=%s AND deleted_at IS NULL",
        (ad_id, corp_id),
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="ad_not_found")
    return row


# ─── GET /ads/{id} ──────────────────────────────────────────────────────────

@router.get("/{ad_id}")
def get_ad(
    ad_id: str,
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    corp_id = _require_corp(x_entity_id, x_entity_type)
    conn = get_db()
    try:
        cur = conn.cursor()
        return _serialize(_fetch_owned(cur, ad_id, corp_id))
    finally:
        conn.close()


# ─── PATCH /ads/{id} ────────────────────────────────────────────────────────

# Whitelist of editable columns. JSON columns are encoded inline.
_SCALAR_COLS = {
    "title_he", "body_he",
    "profession_code", "origin_country", "region", "quantity",
    "experience_min_months", "visa_valid_until",
    "city", "address_he", "total_beds", "available_beds", "price_per_bed_nis",
    "active", "expires_at",
}
_JSON_COLS = {"languages", "amenities", "photos"}


@router.patch("/{ad_id}")
def update_ad(
    ad_id: str,
    body:  AdPatch,
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    corp_id = _require_corp(x_entity_id, x_entity_type)
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="no_changes")

    sets:   list[str]    = []
    params: list[object] = []
    for k, v in data.items():
        if k in _SCALAR_COLS:
            sets.append(f"{k}=%s")
            params.append(v)
        elif k in _JSON_COLS:
            sets.append(f"{k}=%s")
            params.append(json.dumps(v, ensure_ascii=False) if v is not None else None)
    if not sets:
        raise HTTPException(status_code=400, detail="no_editable_fields")

    params.extend([ad_id, corp_id])
    sql = f"UPDATE ads SET {', '.join(sets)} WHERE id=%s AND owner_entity_id=%s AND deleted_at IS NULL"

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="ad_not_found")
        conn.commit()
        cur.execute("SELECT * FROM ads WHERE id=%s", (ad_id,))
        return _serialize(cur.fetchone())
    finally:
        conn.close()


# ─── DELETE /ads/{id} (soft) ────────────────────────────────────────────────

@router.delete("/{ad_id}", status_code=204)
def delete_ad(
    ad_id: str,
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    corp_id = _require_corp(x_entity_id, x_entity_type)
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE ads SET deleted_at=NOW(), active=FALSE WHERE id=%s AND owner_entity_id=%s AND deleted_at IS NULL",
            (ad_id, corp_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="ad_not_found")
        conn.commit()
    finally:
        conn.close()


# ─── GET /ads/{id}/contact-reveal (subscription-gated) ────────────────────
#
# Phase 3 paywall. Anyone (even non-logged) can search and see ad
# bodies; only paying subscribers see the corp's phone/email. We
# call the payment service's /subscriptions/check endpoint to gate
# this — same pattern Phase 5's gateway middleware will use, but
# inline here so contact-reveal works before middleware ships.

@router.get("/{ad_id}/contact-reveal")
def contact_reveal(
    ad_id: str,
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    if not x_entity_id or not x_entity_type:
        raise HTTPException(status_code=401, detail="auth_required")

    # 1. Entitlement + tier
    try:
        ent = fetch_entitlement(x_entity_id, x_entity_type)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail=f"entitlement_service_unreachable: {e}")
    if not ent["entitled"]:
        raise HTTPException(status_code=402, detail={
            "code": "subscription_required", "tier": ent["tier"], "status": ent["status"],
        })

    # 1b. Monthly reveal quota — enforced only if tier has a cap.
    limits = tier_limits(ent["tier"])
    if limits["reveals_per_month"] is not None:
        _conn = get_db()
        try:
            _cur = _conn.cursor()
            _cur.execute(
                """SELECT COUNT(*) AS n FROM contact_reveals
                    WHERE viewer_entity_id=%s AND viewer_entity_type=%s
                      AND revealed_at >= DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00')""",
                (x_entity_id, x_entity_type),
            )
            row = _cur.fetchone()
            used = int(row["n"] if row else 0)
        finally:
            _conn.close()
        if used >= limits["reveals_per_month"]:
            raise HTTPException(status_code=402, detail={
                "code":  "tier_reveal_limit",
                "tier":  ent["tier"],
                "limit": limits["reveals_per_month"],
                "used":  used,
            })

    # 2. Fetch ad + owning corp
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT a.owner_entity_id, c.company_name_he, c.company_name,
                      c.contact_phone, c.contact_email
                 FROM ads a
                 JOIN corporations c ON c.id = a.owner_entity_id
                WHERE a.id = %s AND a.deleted_at IS NULL""",
            (ad_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="ad_not_found")

        # 3. Audit (Phase 5 will use this for per-tier quota counting)
        cur.execute("SHOW TABLES LIKE 'contact_reveals'")
        if cur.fetchone():
            cur.execute(
                """INSERT INTO contact_reveals
                     (id, viewer_entity_id, viewer_entity_type, ad_id, revealed_at)
                   VALUES (%s, %s, %s, %s, NOW())""",
                (str(uuid.uuid4()), x_entity_id, x_entity_type, ad_id),
            )
            conn.commit()

        return {
            "ad_id":        ad_id,
            "company_name": row["company_name_he"] or row["company_name"],
            "phone":        row["contact_phone"],
            "email":        row["contact_email"],
        }
    finally:
        conn.close()


# ─── POST /ads/{id}/boost ───────────────────────────────────────────────────

@router.post("/{ad_id}/boost")
def boost_ad(
    ad_id: str,
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    corp_id = _require_corp(x_entity_id, x_entity_type)

    try:
        ent = fetch_entitlement(corp_id, "corporation")
    except httpx.HTTPError:
        raise HTTPException(status_code=503, detail="entitlement_service_unreachable")
    if not ent["entitled"]:
        raise HTTPException(status_code=402, detail={"code": "subscription_required", "tier": ent["tier"], "status": ent["status"]})
    if not tier_limits(ent["tier"])["can_boost"]:
        raise HTTPException(status_code=402, detail={
            "code": "tier_boost_not_allowed", "tier": ent["tier"],
            "message": "שדרג ל'מתקדם' או 'פרו' כדי לקדם מודעות",
        })

    until = datetime.utcnow() + timedelta(days=BOOST_DAYS)
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE ads SET featured_until=%s WHERE id=%s AND owner_entity_id=%s AND deleted_at IS NULL",
            (until, ad_id, corp_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="ad_not_found")
        conn.commit()
        return {"id": ad_id, "featured_until": until.isoformat()}
    finally:
        conn.close()
