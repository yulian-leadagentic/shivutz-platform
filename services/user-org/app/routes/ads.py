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
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.db import get_db

router = APIRouter()

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


# ─── POST /ads/{id}/boost ───────────────────────────────────────────────────

@router.post("/{ad_id}/boost")
def boost_ad(
    ad_id: str,
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    corp_id = _require_corp(x_entity_id, x_entity_type)
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
