"""R6 · admin CRUD for the exclusive-slot sponsor inventory.

Yulian 18.09 decided on exclusive category slots per placement per
date window at a flat price. This router is the bookkeeping side:
list all slots, create a new one (with overlap detection), edit
price/dates/note, book/unbook a sponsor_ads creative into the slot,
and delete an empty slot.

The runtime side (ads.py) does the resolution: for any call to
/ads/public/sponsored with a (placement, category), it looks up
sponsor_ads_slots FIRST — a booked slot is exclusive for its window
and short-circuits the legacy RAND() pool.
"""
from datetime import datetime
from typing import Optional
import json

from fastapi import APIRouter, HTTPException, Header, Query
from pydantic import BaseModel, Field

from app.db import get_db

router = APIRouter()

_ALLOWED_PLACEMENTS = {
    "search_inline",
    "marketplace_banner",
    "marketplace_carousel",
    "home_banner",
    "home_carousel",
}


def _serialize(row: dict) -> dict:
    out = dict(row)
    for k, v in list(out.items()):
        if isinstance(v, datetime):
            out[k] = v.isoformat()
    return out


# ── List ──────────────────────────────────────────────────────────────────
#
# Admin sees the whole shelf — booked + unbooked, past + present + future.
# The current-status column (upcoming / live / booked / ended / vacant) is
# derived on the FE from starts_at / ends_at / sponsor_ad_id, keeping the
# server payload compact.

@router.get("/sponsor-slots")
def list_slots(
    placement:     Optional[str] = Query(default=None),
    category_code: Optional[str] = Query(default=None),
    booked:        Optional[bool] = Query(default=None),
):
    wheres = []
    params: list[object] = []
    if placement:
        if placement not in _ALLOWED_PLACEMENTS:
            raise HTTPException(status_code=400, detail="invalid_placement")
        wheres.append("s.placement = %s")
        params.append(placement)
    if category_code is not None:
        # Empty string means "category NULL" (category-agnostic slot).
        if category_code == "":
            wheres.append("s.category_code IS NULL")
        else:
            wheres.append("s.category_code = %s")
            params.append(category_code)
    if booked is not None:
        wheres.append("s.sponsor_ad_id IS " + ("NOT NULL" if booked else "NULL"))

    # Cross-schema join to display the advertiser name; slots live in
    # org_db, sponsor_ads too, so no COLLATE dance needed. Order by
    # starts_at DESC so the imminent windows are at the top.
    sql = f"""
        SELECT s.*,
               sa.advertiser_name,
               sa.headline_he
          FROM sponsor_ads_slots s
          LEFT JOIN sponsor_ads sa ON sa.id = s.sponsor_ad_id
         {'WHERE ' + ' AND '.join(wheres) if wheres else ''}
         ORDER BY s.starts_at DESC
         LIMIT 500
    """
    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        return [_serialize(r) for r in cur.fetchall()]
    finally:
        conn.close()


# ── Create ────────────────────────────────────────────────────────────────

class SlotCreate(BaseModel):
    placement:     str
    category_code: Optional[str] = None      # None → category-agnostic (home_*)
    starts_at:     datetime
    ends_at:       datetime
    price_nis:     int = Field(ge=0, le=1_000_000)
    sponsor_ad_id: Optional[str] = None      # None → unsold, bookable later
    note:          Optional[str] = None


def _assert_no_overlap(cur, placement: str, category_code: Optional[str],
                       starts_at: datetime, ends_at: datetime,
                       exclude_id: Optional[str] = None) -> None:
    """MySQL has no exclusion constraint, so we enforce at write time.

    Two slots overlap iff starts_at_a < ends_at_b AND ends_at_a > starts_at_b
    for the same (placement, category_code) tuple. NULL category matches
    only NULL (a category-specific slot and a category-agnostic slot do
    NOT overlap — they cover different audiences).
    """
    if ends_at <= starts_at:
        raise HTTPException(status_code=400, detail="ends_at_must_be_after_starts_at")
    if category_code is None:
        cat_where = "s.category_code IS NULL"
        cat_params = ()
    else:
        cat_where = "s.category_code = %s"
        cat_params = (category_code,)
    exclude_where = " AND s.id <> %s" if exclude_id else ""
    exclude_params = (exclude_id,) if exclude_id else ()
    cur.execute(
        f"""SELECT s.id, s.starts_at, s.ends_at
              FROM sponsor_ads_slots s
             WHERE s.placement = %s
               AND {cat_where}
               AND s.starts_at < %s
               AND s.ends_at   > %s
               {exclude_where}
             LIMIT 1""",
        (placement, *cat_params, ends_at, starts_at, *exclude_params),
    )
    clash = cur.fetchone()
    if clash:
        raise HTTPException(
            status_code=409,
            detail={
                "code":       "slot_overlap",
                "message":    "כבר יש סלוט חופף לקטגוריה ולמיקום האלה בטווח התאריכים.",
                "clash_id":   clash["id"],
                "clash_from": clash["starts_at"].isoformat(),
                "clash_to":   clash["ends_at"].isoformat(),
            },
        )


@router.post("/sponsor-slots", status_code=201)
def create_slot(body: SlotCreate, x_user_id: Optional[str] = Header(default=None)):
    if body.placement not in _ALLOWED_PLACEMENTS:
        raise HTTPException(status_code=400, detail="invalid_placement")
    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        _assert_no_overlap(cur, body.placement, body.category_code,
                           body.starts_at, body.ends_at)
        # Validate sponsor_ad_id exists if given.
        if body.sponsor_ad_id:
            cur.execute("SELECT id FROM sponsor_ads WHERE id=%s", (body.sponsor_ad_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=400, detail="sponsor_ad_not_found")
        # Category validation is intentionally soft — an admin editing a
        # slot for a category they're about to add would hit a hard
        # error otherwise. The lookup endpoint on the FE picks from
        # the live catalog.
        cur.execute(
            """INSERT INTO sponsor_ads_slots
                 (id, placement, category_code, starts_at, ends_at,
                  price_nis, sponsor_ad_id, note)
               VALUES (UUID(), %s, %s, %s, %s, %s, %s, %s)""",
            (body.placement, body.category_code, body.starts_at, body.ends_at,
             body.price_nis, body.sponsor_ad_id, (body.note or None)),
        )
        conn.commit()
        cur.execute(
            "SELECT * FROM sponsor_ads_slots WHERE placement=%s "
            "AND starts_at=%s AND ends_at=%s ORDER BY created_at DESC LIMIT 1",
            (body.placement, body.starts_at, body.ends_at),
        )
        return _serialize(cur.fetchone())
    finally:
        conn.close()


# ── Update ────────────────────────────────────────────────────────────────

class SlotPatch(BaseModel):
    starts_at:     Optional[datetime] = None
    ends_at:       Optional[datetime] = None
    price_nis:     Optional[int]      = Field(default=None, ge=0, le=1_000_000)
    sponsor_ad_id: Optional[str]      = None
    unbook:        Optional[bool]     = None   # true = clear sponsor_ad_id
    note:          Optional[str]      = None


@router.patch("/sponsor-slots/{slot_id}")
def update_slot(slot_id: str, body: SlotPatch):
    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM sponsor_ads_slots WHERE id=%s", (slot_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="slot_not_found")

        new_starts = body.starts_at or row["starts_at"]
        new_ends   = body.ends_at   or row["ends_at"]
        if body.starts_at or body.ends_at:
            _assert_no_overlap(cur, row["placement"], row["category_code"],
                               new_starts, new_ends, exclude_id=slot_id)

        sets = []
        params: list[object] = []
        if body.starts_at is not None:
            sets.append("starts_at=%s"); params.append(body.starts_at)
        if body.ends_at is not None:
            sets.append("ends_at=%s"); params.append(body.ends_at)
        if body.price_nis is not None:
            sets.append("price_nis=%s"); params.append(body.price_nis)
        if body.unbook:
            sets.append("sponsor_ad_id=NULL")
        elif body.sponsor_ad_id is not None:
            cur.execute("SELECT id FROM sponsor_ads WHERE id=%s", (body.sponsor_ad_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=400, detail="sponsor_ad_not_found")
            sets.append("sponsor_ad_id=%s"); params.append(body.sponsor_ad_id)
        if body.note is not None:
            sets.append("note=%s"); params.append(body.note or None)
        if not sets:
            return _serialize(row)
        params.append(slot_id)
        cur.execute(f"UPDATE sponsor_ads_slots SET {', '.join(sets)} WHERE id=%s", params)
        conn.commit()
        cur.execute("SELECT * FROM sponsor_ads_slots WHERE id=%s", (slot_id,))
        return _serialize(cur.fetchone())
    finally:
        conn.close()


# ── Delete ────────────────────────────────────────────────────────────────

@router.delete("/sponsor-slots/{slot_id}", status_code=204)
def delete_slot(slot_id: str):
    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM sponsor_ads_slots WHERE id=%s", (slot_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="slot_not_found")
        conn.commit()
    finally:
        conn.close()
