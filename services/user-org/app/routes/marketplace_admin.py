"""
Marketplace admin endpoints — categories + subscription tiers.

Only admin users (gateway forwards `x-user-role: admin`) can hit these.
The matching frontend lives at `/admin/marketplace/categories`.

Mounted by main.py under `/marketplace/admin`, so paths land at
`/api/marketplace/admin/...` once the gateway is in front.
"""
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, Field
from typing import Optional
from decimal import Decimal
import uuid

from app.db import get_db

router = APIRouter()


# ── Auth helper ───────────────────────────────────────────────────────

def _require_admin(x_user_role: Optional[str]):
    if x_user_role != "admin":
        raise HTTPException(status_code=403, detail="admin_only")


# ── Pydantic models ───────────────────────────────────────────────────

class CategoryUpsert(BaseModel):
    code:       str = Field(min_length=2, max_length=50)
    name_he:    str = Field(min_length=1, max_length=120)
    name_en:    str = Field(min_length=1, max_length=120)
    name_ar:    Optional[str] = Field(default=None, max_length=120)
    icon_slug:  Optional[str] = Field(default=None, max_length=40)
    sort_order: int = 0
    is_active:  bool = True


class CategoryPatch(BaseModel):
    name_he:    Optional[str] = Field(default=None, max_length=120)
    name_en:    Optional[str] = Field(default=None, max_length=120)
    name_ar:    Optional[str] = Field(default=None, max_length=120)
    icon_slug:  Optional[str] = Field(default=None, max_length=40)
    sort_order: Optional[int] = None
    is_active:  Optional[bool] = None


class TierUpsert(BaseModel):
    name_he:       str = Field(min_length=1, max_length=80)
    name_en:       str = Field(min_length=1, max_length=80)
    slot_count:    int = Field(ge=1, le=999)
    duration_days: int = Field(ge=1, le=3650)
    price_nis:     Decimal = Field(ge=0)
    sort_order:    int = 0
    is_active:     bool = True


class TierPatch(BaseModel):
    name_he:       Optional[str]     = Field(default=None, max_length=80)
    name_en:       Optional[str]     = Field(default=None, max_length=80)
    slot_count:    Optional[int]     = Field(default=None, ge=1, le=999)
    duration_days: Optional[int]     = Field(default=None, ge=1, le=3650)
    price_nis:     Optional[Decimal] = Field(default=None, ge=0)
    sort_order:    Optional[int]     = None
    is_active:     Optional[bool]    = None


def _serialize(row: dict) -> dict:
    out = {}
    for k, v in row.items():
        if hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        elif isinstance(v, Decimal):
            out[k] = float(v)
        else:
            out[k] = v
    return out


# ── GET /marketplace/admin/categories ────────────────────────────────

@router.get("/categories")
def list_categories(x_user_role: Optional[str] = Header(default=None)):
    _require_admin(x_user_role)
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT code, name_he, name_en, name_ar, icon_slug,
                      sort_order, is_active, created_at, updated_at
                 FROM marketplace_categories
                ORDER BY sort_order, code"""
        )
        return [_serialize(r) for r in cur.fetchall()]
    finally:
        conn.close()


# ── POST /marketplace/admin/categories ───────────────────────────────

@router.post("/categories", status_code=201)
def create_category(body: CategoryUpsert, x_user_role: Optional[str] = Header(default=None)):
    _require_admin(x_user_role)
    conn = get_db()
    try:
        cur = conn.cursor()
        try:
            cur.execute(
                """INSERT INTO marketplace_categories
                       (code, name_he, name_en, name_ar, icon_slug, sort_order, is_active)
                   VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                (body.code, body.name_he, body.name_en, body.name_ar,
                 body.icon_slug, body.sort_order, body.is_active),
            )
        except Exception as e:
            if "Duplicate" in str(e):
                raise HTTPException(status_code=409, detail="category_code_taken")
            raise
        conn.commit()
        return {"code": body.code}
    finally:
        conn.close()


# ── PATCH /marketplace/admin/categories/{code} ───────────────────────

@router.patch("/categories/{code}")
def update_category(code: str, body: CategoryPatch, x_user_role: Optional[str] = Header(default=None)):
    _require_admin(x_user_role)
    updates, params = [], []
    for field, val in body.model_dump(exclude_none=True).items():
        updates.append(f"{field}=%s")
        params.append(val)
    if not updates:
        return {"code": code, "updated": False}
    params.append(code)

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(f"UPDATE marketplace_categories SET {', '.join(updates)} WHERE code=%s", params)
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="category_not_found")
        conn.commit()
        return {"code": code, "updated": True}
    finally:
        conn.close()


# ── GET /marketplace/admin/categories/{code}/tiers ───────────────────

@router.get("/categories/{code}/tiers")
def list_tiers(code: str, x_user_role: Optional[str] = Header(default=None)):
    _require_admin(x_user_role)
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT id, category_code, name_he, name_en, slot_count, duration_days,
                      price_nis, sort_order, is_active, created_at, updated_at
                 FROM marketplace_subscription_tiers
                WHERE category_code = %s
                ORDER BY sort_order, name_en""",
            (code,),
        )
        return [_serialize(r) for r in cur.fetchall()]
    finally:
        conn.close()


# ── POST /marketplace/admin/categories/{code}/tiers ──────────────────

@router.post("/categories/{code}/tiers", status_code=201)
def create_tier(code: str, body: TierUpsert, x_user_role: Optional[str] = Header(default=None)):
    _require_admin(x_user_role)
    tier_id = str(uuid.uuid4())
    conn = get_db()
    try:
        cur = conn.cursor()
        # Verify category exists
        cur.execute("SELECT 1 FROM marketplace_categories WHERE code=%s", (code,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="category_not_found")

        cur.execute(
            """INSERT INTO marketplace_subscription_tiers
                   (id, category_code, name_he, name_en, slot_count,
                    duration_days, price_nis, sort_order, is_active)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (tier_id, code, body.name_he, body.name_en, body.slot_count,
             body.duration_days, body.price_nis, body.sort_order, body.is_active),
        )
        conn.commit()
        return {"id": tier_id, "category_code": code}
    finally:
        conn.close()


# ── PATCH /marketplace/admin/tiers/{tier_id} ─────────────────────────

@router.patch("/tiers/{tier_id}")
def update_tier(tier_id: str, body: TierPatch, x_user_role: Optional[str] = Header(default=None)):
    _require_admin(x_user_role)
    updates, params = [], []
    for field, val in body.model_dump(exclude_none=True).items():
        updates.append(f"{field}=%s")
        params.append(val)
    if not updates:
        return {"id": tier_id, "updated": False}
    params.append(tier_id)

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(f"UPDATE marketplace_subscription_tiers SET {', '.join(updates)} WHERE id=%s", params)
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="tier_not_found")
        conn.commit()
        return {"id": tier_id, "updated": True}
    finally:
        conn.close()


# ── DELETE /marketplace/admin/tiers/{tier_id} ────────────────────────

@router.delete("/tiers/{tier_id}", status_code=204)
def delete_tier(tier_id: str, x_user_role: Optional[str] = Header(default=None)):
    _require_admin(x_user_role)
    conn = get_db()
    try:
        cur = conn.cursor()
        # FK from marketplace_subscriptions.tier_id is RESTRICT — if there
        # are live subscriptions on this tier we 409 instead of breaking
        # them. Admin should mark is_active=false on the tier instead.
        try:
            cur.execute("DELETE FROM marketplace_subscription_tiers WHERE id=%s", (tier_id,))
        except Exception as e:
            if "foreign key" in str(e).lower():
                raise HTTPException(status_code=409, detail="tier_in_use_set_inactive_instead")
            raise
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="tier_not_found")
        conn.commit()
    finally:
        conn.close()


# ── Public read for the subscriber flow (Phase 2.1) ──────────────────
# The subscriber-facing "pick a tier" page needs a non-admin endpoint
# that returns active categories + their active tiers in one call.
# Lives here because it shares the data; auth is just "any logged-in
# advertiser", so no role check.

@router.get("/catalog")
def public_catalog():
    """Return active categories with their active tiers (no auth — the
    flow checks subscription state separately on purchase)."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT c.code, c.name_he, c.name_en, c.name_ar, c.icon_slug, c.sort_order
                 FROM marketplace_categories c
                WHERE c.is_active = TRUE
                ORDER BY c.sort_order, c.code"""
        )
        cats = [_serialize(r) for r in cur.fetchall()]
        if not cats:
            return []

        codes = tuple(c["code"] for c in cats)
        placeholders = ",".join(["%s"] * len(codes))
        cur.execute(
            f"""SELECT id, category_code, name_he, name_en, slot_count, duration_days,
                       price_nis, sort_order
                  FROM marketplace_subscription_tiers
                 WHERE is_active = TRUE AND category_code IN ({placeholders})
                 ORDER BY sort_order, price_nis""",
            codes,
        )
        by_cat: dict[str, list] = {}
        for row in cur.fetchall():
            by_cat.setdefault(row["category_code"], []).append(_serialize(row))
        for c in cats:
            c["tiers"] = by_cat.get(c["code"], [])
        return cats
    finally:
        conn.close()
