"""
Marketplace — public listings board.
Corporations post housing/equipment/services. Anyone can browse.
"""
from fastapi import APIRouter, HTTPException, Header, Query
from pydantic import BaseModel
from typing import Optional, List
from decimal import Decimal
import json
import uuid

from app.db import get_db

router = APIRouter()

# ── Pydantic models ────────────────────────────────────────────────────────────

class ListingCreate(BaseModel):
    category:       str                    # housing | equipment | services | other
    subcategory:    Optional[str] = None
    title:          str
    description:    Optional[str] = None
    city:           Optional[str] = None
    region:         Optional[str] = None
    price:          Optional[Decimal] = None
    price_unit:     Optional[str] = None   # per_month | per_night | fixed | negotiable
    capacity:       Optional[int] = None
    is_furnished:   Optional[bool] = None
    available_from: Optional[str] = None   # ISO date
    contact_phone:  Optional[str] = None
    contact_name:   Optional[str] = None
    # Cloudinary secure_urls — accepted from the frontend after the
    # browser → Cloudinary direct upload completes. Capped server-side
    # so a malicious client can't pad the JSON column with thousands.
    images_json:    Optional[List[str]] = None

class ListingUpdate(BaseModel):
    title:          Optional[str] = None
    description:    Optional[str] = None
    city:           Optional[str] = None
    region:         Optional[str] = None
    price:          Optional[Decimal] = None
    price_unit:     Optional[str] = None
    capacity:       Optional[int] = None
    is_furnished:   Optional[bool] = None
    available_from: Optional[str] = None
    contact_phone:  Optional[str] = None
    contact_name:   Optional[str] = None
    status:         Optional[str] = None   # active | rented | sold | paused
    images_json:    Optional[List[str]] = None

# Soft-cap on stored image URLs per listing — protects against runaway
# JSON columns. Not enforced at the DB level; FE shouldn't allow more
# either (Cloudinary uploader caps too).
_MAX_IMAGES_PER_LISTING = 12

class LeadCreate(BaseModel):
    full_name: str
    phone:     str
    org_type:  str   # contractor | corporation
    notes:     Optional[str] = None


def _serialize(row: dict) -> dict:
    result = {}
    for k, v in row.items():
        # JSON columns come back as strings from PyMySQL — parse so the
        # frontend gets a real array. Defensively skip if already a list.
        if k == "images_json":
            if isinstance(v, str):
                try:
                    result[k] = json.loads(v)
                except json.JSONDecodeError:
                    result[k] = []
            else:
                result[k] = v or []
            continue
        if hasattr(v, 'isoformat'):
            result[k] = v.isoformat()
        elif isinstance(v, Decimal):
            result[k] = float(v)
        else:
            result[k] = v
    return result


# ── GET /marketplace ───────────────────────────────────────────────────────────

@router.get("")
def list_listings(
    category:     Optional[str] = Query(default=None),
    region:       Optional[str] = Query(default=None),
    city:         Optional[str] = Query(default=None),
    min_capacity: Optional[int] = Query(default=None),
    search:       Optional[str] = Query(default=None),
    mine:         bool          = Query(default=False),
    limit:        int           = Query(default=50, le=100),
    offset:       int           = Query(default=0),
    x_entity_id:  Optional[str] = Header(default=None),
    x_org_id:     Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    """Public listing. Pass mine=true to get only your own listings (auth required)."""
    conn = get_db()
    try:
        cur = conn.cursor()
        conditions = ["ml.deleted_at IS NULL"]
        params: list = []

        if mine:
            entity_id = x_entity_id or x_org_id
            entity_type = (x_entity_type or "").lower()
            if not entity_id:
                raise HTTPException(status_code=401, detail="Auth required for mine=true")
            # Match against advertiser_entity_* (the new dimension).
            # corporation_id is kept in sync for legacy corp rows so we
            # could query either, but advertiser_entity_* covers both
            # contractor and corp advertisers cleanly.
            conditions.append("ml.advertiser_entity_id = %s")
            params.append(entity_id)
            if entity_type in ("contractor", "corporation"):
                conditions.append("ml.advertiser_entity_type = %s")
                params.append(entity_type)
        else:
            conditions.append("ml.status = 'active'")

        if category:
            conditions.append("ml.category = %s")
            params.append(category)
        if region:
            conditions.append("ml.region = %s")
            params.append(region)
        if city:
            conditions.append("ml.city LIKE %s")
            params.append(f"%{city}%")
        if min_capacity is not None:
            conditions.append("ml.capacity >= %s")
            params.append(min_capacity)
        if search:
            conditions.append("(ml.title LIKE %s OR ml.description LIKE %s OR ml.city LIKE %s)")
            like = f"%{search}%"
            params.extend([like, like, like])

        where = " AND ".join(conditions)
        params.extend([limit, offset])

        cur.execute(f"""
            SELECT ml.*,
                   c.company_name_he AS corporation_name_he,
                   c.company_name    AS corporation_name_en,
                   c.approval_status AS corporation_approval_status
              FROM marketplace_listings ml
              LEFT JOIN corporations c ON ml.corporation_id = c.id
             WHERE {where}
             ORDER BY ml.created_at DESC
             LIMIT %s OFFSET %s
        """, params)

        rows = cur.fetchall()
        result = []
        for row in rows:
            r = _serialize(row)
            r["corporation_name"] = r.pop("corporation_name_he") or r.pop("corporation_name_en") or ""
            r["is_corporation_verified"] = r.pop("corporation_approval_status") == "approved"
            result.append(r)
        return result
    finally:
        conn.close()


# ── GET /marketplace/:id ───────────────────────────────────────────────────────

@router.get("/{listing_id}")
def get_listing(listing_id: str):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT ml.*,
                   c.company_name_he AS corporation_name_he,
                   c.company_name    AS corporation_name_en,
                   c.approval_status AS corporation_approval_status
              FROM marketplace_listings ml
              LEFT JOIN corporations c ON ml.corporation_id = c.id
             WHERE ml.id = %s AND ml.deleted_at IS NULL
        """, (listing_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Listing not found")
        r = _serialize(row)
        r["corporation_name"] = r.pop("corporation_name_he") or r.pop("corporation_name_en") or ""
        r["is_corporation_verified"] = r.pop("corporation_approval_status") == "approved"
        return r
    finally:
        conn.close()


# ── POST /marketplace ──────────────────────────────────────────────────────────

@router.post("", status_code=201)
def create_listing(
    body: ListingCreate,
    x_entity_id:  Optional[str] = Header(default=None),
    x_org_id:     Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    """Publish a new listing.

    Phase 2.1 changes:
    - Both contractors and corporations can publish (V0 was corp-only).
    - Requires an active subscription in the chosen category with at
      least one available slot. The subscription is found from the
      caller + body.category and recorded on the listing for billing
      and for slot accounting.
    """
    entity_id   = x_entity_id or x_org_id
    entity_type = (x_entity_type or "").lower()
    if not entity_id or entity_type not in ("contractor", "corporation"):
        raise HTTPException(status_code=403, detail="advertiser_required")
    if not body.title.strip():
        raise HTTPException(status_code=400, detail="title_required")
    if not body.category:
        raise HTTPException(status_code=400, detail="category_required")

    listing_id = str(uuid.uuid4())
    conn = get_db()
    try:
        cur = conn.cursor()

        # Find an active subscription that covers this category + has a
        # free slot. Locking the row would matter only at very high
        # concurrency; for now a serialized read is fine.
        cur.execute(
            """SELECT id, slot_count
                 FROM marketplace_subscriptions
                WHERE advertiser_entity_type = %s
                  AND advertiser_entity_id   = %s
                  AND category_code          = %s
                  AND status                 = 'active'
                  AND expires_at             > NOW()
                ORDER BY expires_at DESC LIMIT 1""",
            (entity_type, entity_id, body.category),
        )
        sub = cur.fetchone()
        if not sub:
            raise HTTPException(
                status_code=402,  # 402 Payment Required — closest fit
                detail={
                    "code": "no_active_subscription",
                    "message": "אין מנוי פעיל בקטגוריה זו. רכוש מנוי כדי לפרסם.",
                    "category": body.category,
                },
            )

        cur.execute(
            """SELECT COUNT(*) AS n FROM marketplace_listings
                WHERE subscription_id = %s
                  AND deleted_at IS NULL
                  AND status = 'active'""",
            (sub["id"],),
        )
        used = int(cur.fetchone()["n"])
        if used >= sub["slot_count"]:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "no_slots_available",
                    "message": "כל מקומות הפרסום במנוי הזה מנוצלים. השבת מודעה קיימת או שדרג את המנוי.",
                    "slot_count": sub["slot_count"],
                    "slots_used": used,
                },
            )

        # `corporation_id` is preserved for the V0 read path until 2.2
        # rewrites browse to use advertiser_entity_*; for contractor
        # advertisers we leave it NULL.
        legacy_corp_id = entity_id if entity_type == "corporation" else None
        images = body.images_json or []
        if len(images) > _MAX_IMAGES_PER_LISTING:
            images = images[:_MAX_IMAGES_PER_LISTING]
        cur.execute("""
            INSERT INTO marketplace_listings
              (id, corporation_id, subscription_id,
               advertiser_entity_type, advertiser_entity_id,
               category, subcategory, title, description,
               city, region, price, price_unit, capacity, is_furnished,
               available_from, contact_phone, contact_name, images_json)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, (
            listing_id, legacy_corp_id, sub["id"],
            entity_type, entity_id,
            body.category, body.subcategory, body.title.strip(), body.description,
            body.city, body.region, body.price, body.price_unit,
            body.capacity, body.is_furnished, body.available_from,
            body.contact_phone, body.contact_name,
            json.dumps(images) if images else None,
        ))
        conn.commit()
        return {
            "id": listing_id,
            "status": "active",
            "subscription_id": sub["id"],
            "slots_used": used + 1,
            "slot_count": sub["slot_count"],
        }
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


# ── PATCH /marketplace/:id ─────────────────────────────────────────────────────

@router.patch("/{listing_id}")
def update_listing(
    listing_id: str,
    body: ListingUpdate,
    x_entity_id: Optional[str] = Header(default=None),
    x_org_id:    Optional[str] = Header(default=None),
):
    entity_id = x_entity_id or x_org_id
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT id, corporation_id, advertiser_entity_id
                 FROM marketplace_listings WHERE id=%s AND deleted_at IS NULL""",
            (listing_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Listing not found")
        # Owner check — match either the legacy corporation_id (existing
        # corp-side rows) or the new advertiser_entity_id (contractor or
        # newly-created rows).
        is_owner = (row["corporation_id"] == entity_id) or (row["advertiser_entity_id"] == entity_id)
        if not is_owner:
            raise HTTPException(status_code=403, detail="Forbidden")

        updates, params = [], []
        for field, val in body.model_dump(exclude_none=True).items():
            if field == "images_json":
                # images_json is a JSON column; cap and serialize.
                imgs = val if isinstance(val, list) else []
                if len(imgs) > _MAX_IMAGES_PER_LISTING:
                    imgs = imgs[:_MAX_IMAGES_PER_LISTING]
                updates.append("images_json=%s")
                params.append(json.dumps(imgs) if imgs else None)
            else:
                updates.append(f"{field}=%s")
                params.append(val)
        if not updates:
            return {"id": listing_id, "updated": False}

        params.append(listing_id)
        cur.execute(f"UPDATE marketplace_listings SET {', '.join(updates)} WHERE id=%s", params)
        conn.commit()
        return {"id": listing_id, "updated": True}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


# ── DELETE /marketplace/:id ────────────────────────────────────────────────────

@router.delete("/{listing_id}", status_code=204)
def delete_listing(
    listing_id: str,
    x_entity_id: Optional[str] = Header(default=None),
    x_org_id:    Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    entity_id = x_entity_id or x_org_id
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT id, corporation_id, advertiser_entity_id
                 FROM marketplace_listings WHERE id=%s AND deleted_at IS NULL""",
            (listing_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Listing not found")
        is_owner = (row["corporation_id"] == entity_id) or (row["advertiser_entity_id"] == entity_id)
        if x_user_role != "admin" and not is_owner:
            raise HTTPException(status_code=403, detail="Forbidden")

        cur.execute("UPDATE marketplace_listings SET deleted_at=NOW(), status='paused' WHERE id=%s", (listing_id,))
        conn.commit()
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


# ── POST /marketplace/leads ────────────────────────────────────────────────────

@router.post("/leads", status_code=201)
def submit_lead(body: LeadCreate):
    if not body.full_name.strip() or not body.phone.strip():
        raise HTTPException(status_code=400, detail="שם וטלפון הם שדות חובה")
    if body.org_type not in ("contractor", "corporation"):
        raise HTTPException(status_code=400, detail="org_type must be contractor or corporation")

    lead_id = str(uuid.uuid4())
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO leads (id, full_name, phone, org_type, notes) VALUES (%s,%s,%s,%s,%s)",
            (lead_id, body.full_name.strip(), body.phone.strip(), body.org_type, body.notes)
        )
        conn.commit()
        return {"id": lead_id, "message": "תודה! ניצור איתך קשר בקרוב"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()
# Wave 4 deploy probe — 2026-05-07T09:12:51Z
