"""
Admin endpoint for managing per-corporation recruitment pricing.
Each corporation has a pricing record: a fixed fee charged per accepted deal.
"""
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from decimal import Decimal
from typing import Optional, List
import uuid

from app.db import get_db

router = APIRouter()


def _serialize(row: dict) -> dict:
    for k, v in row.items():
        if hasattr(v, 'isoformat'):
            row[k] = v.isoformat()
        elif isinstance(v, Decimal):
            row[k] = float(v)
    return row


def _load_corp_names(conn, corp_ids: set) -> dict:
    """Batch-fetch Hebrew (or fallback) names for a set of corporation IDs."""
    if not corp_ids:
        return {}
    cur = conn.cursor()
    placeholders = ",".join(["%s"] * len(corp_ids))
    cur.execute(
        f"SELECT id, company_name_he, company_name FROM corporations WHERE id IN ({placeholders})",
        tuple(corp_ids),
    )
    names: dict = {}
    for row in cur.fetchall():
        names[row["id"]] = row.get("company_name_he") or row.get("company_name") or row["id"][:8]
    return names


class PricingCreate(BaseModel):
    corporation_id: str
    price_per_deal: Decimal
    valid_from: str           # ISO date
    valid_until: Optional[str] = None
    notes: Optional[str] = None


class PricingUpdate(BaseModel):
    price_per_deal: Optional[Decimal] = None
    valid_until: Optional[str] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


# ── GET /admin/pricing ──────────────────────────────────────────────────────

@router.get("/pricing")
def list_pricing():
    deal_conn = get_db("deal_db")
    org_conn  = get_db("org_db")
    try:
        cur = deal_conn.cursor()
        cur.execute("""
            SELECT * FROM corporation_pricing ORDER BY is_active DESC, created_at DESC
        """)
        rows = [_serialize(r) for r in cur.fetchall()]
        # Batched enrichment — single round-trip to org_db instead of one per row.
        names = _load_corp_names(org_conn, {r["corporation_id"] for r in rows})
        for row in rows:
            row["corporation_name"] = names.get(row["corporation_id"], row["corporation_id"][:8])
        return rows
    finally:
        deal_conn.close()
        org_conn.close()


# ── GET /admin/pricing/corporation/{corp_id} ────────────────────────────────

@router.get("/pricing/corporation/{corp_id}")
def get_corp_pricing(corp_id: str):
    """Get the current active pricing for a corporation."""
    conn = get_db("deal_db")
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT * FROM corporation_pricing
            WHERE corporation_id=%s AND is_active=1
              AND (valid_until IS NULL OR valid_until >= CURDATE())
            ORDER BY created_at DESC
            LIMIT 1
        """, (corp_id,))
        row = cur.fetchone()
        if not row:
            return None
        return _serialize(row)
    finally:
        conn.close()


# ── POST /admin/pricing ─────────────────────────────────────────────────────

@router.post("/pricing", status_code=201)
def create_pricing(
    data: PricingCreate,
    x_user_id: Optional[str] = Header(default=None),
):
    pricing_id = str(uuid.uuid4())
    conn = get_db("deal_db")
    try:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO corporation_pricing
              (id, corporation_id, price_per_deal, valid_from, valid_until, notes, created_by)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
        """, (
            pricing_id, data.corporation_id, data.price_per_deal,
            data.valid_from, data.valid_until, data.notes, x_user_id or "admin"
        ))
        conn.commit()
        return {"id": pricing_id, "price_per_deal": float(data.price_per_deal)}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


# ── PATCH /admin/pricing/{pricing_id} ──────────────────────────────────────

@router.patch("/pricing/{pricing_id}")
def update_pricing(pricing_id: str, data: PricingUpdate):
    conn = get_db("deal_db")
    try:
        cur = conn.cursor()
        cur.execute("SELECT id FROM corporation_pricing WHERE id=%s", (pricing_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Pricing not found")

        sets, params = [], []
        if data.price_per_deal is not None:
            sets.append("price_per_deal=%s"); params.append(data.price_per_deal)
        if data.valid_until is not None:
            sets.append("valid_until=%s"); params.append(data.valid_until)
        if data.is_active is not None:
            sets.append("is_active=%s"); params.append(1 if data.is_active else 0)
        if data.notes is not None:
            sets.append("notes=%s"); params.append(data.notes)
        if not sets:
            raise HTTPException(status_code=400, detail="No fields to update")

        params.append(pricing_id)
        cur.execute(f"UPDATE corporation_pricing SET {', '.join(sets)} WHERE id=%s", params)
        conn.commit()
        return {"id": pricing_id, "updated": True}
    finally:
        conn.close()
