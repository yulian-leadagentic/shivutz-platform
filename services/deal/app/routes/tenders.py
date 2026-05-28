"""Foreign-worker import tenders (מכרז ייבוא עובדים מחו״ל).

A separate flow from the in-country `deals` model:
  * No matcher — the contractor publishes a tender, corps submit bids.
  * Multi-profession per tender (line items).
  * Partial bids — a corp offers how many of each profession it can
    supply; the contractor can combine several corps.
  * Admin-mediated. No card. The admin approves + REVEALS the parties
    to each other. Until then it's double-blind: the contractor sees
    corps as "תאגיד N" and corps see the contractor as "קבלן".

All routes are mounted under /tenders (see main.py). The gateway
projects:
  x-user-id   → acting user
  x-org-id    → acting entity (contractor_id or corporation_id)
  x-user-role → 'contractor' | 'corporation' | 'admin'
"""

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from decimal import Decimal
import uuid

from app.db import get_db
from app.services import audit
from app.publisher import publish_event

router = APIRouter()


# ── Serialization helpers ───────────────────────────────────────────

def _ser(row: dict) -> dict:
    out = {}
    for k, v in row.items():
        if hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        elif isinstance(v, Decimal):
            out[k] = float(v)
        else:
            out[k] = v
    return out


# ── Request models ──────────────────────────────────────────────────

class TenderItemIn(BaseModel):
    profession_type: str
    quantity: int
    min_experience: int = 0
    notes: Optional[str] = None


class TenderCreate(BaseModel):
    title: Optional[str] = None
    origin_country: Optional[str] = None
    region: Optional[str] = None
    target_start_date: Optional[str] = None
    notes: Optional[str] = None
    items: List[TenderItemIn]


class BidItemIn(BaseModel):
    tender_item_id: str
    profession_type: str
    quantity_offered: int
    unit_price: Optional[float] = None


class BidCreate(BaseModel):
    total_price: Optional[float] = None
    currency: str = "ILS"
    delivery_estimate_days: Optional[int] = None
    notes: Optional[str] = None
    items: List[BidItemIn]


class SelectBids(BaseModel):
    bid_ids: List[str]


# ── Internal loaders ────────────────────────────────────────────────

def _load_tender(conn, tender_id: str) -> Optional[dict]:
    cur = conn.cursor()
    cur.execute("SELECT * FROM foreign_tenders WHERE id=%s", (tender_id,))
    return cur.fetchone()


def _load_items(conn, tender_id: str) -> List[dict]:
    cur = conn.cursor()
    cur.execute(
        "SELECT * FROM foreign_tender_items WHERE tender_id=%s ORDER BY created_at",
        (tender_id,),
    )
    return [_ser(r) for r in cur.fetchall()]


def _load_bids_with_items(conn, tender_id: str) -> List[dict]:
    """Return every bid on a tender, each with its line items nested."""
    cur = conn.cursor()
    cur.execute(
        "SELECT * FROM foreign_bids WHERE tender_id=%s ORDER BY submitted_at",
        (tender_id,),
    )
    bids = [_ser(r) for r in cur.fetchall()]
    for b in bids:
        cur.execute(
            "SELECT * FROM foreign_bid_items WHERE bid_id=%s ORDER BY created_at",
            (b["id"],),
        )
        b["items"] = [_ser(r) for r in cur.fetchall()]
    return bids


def _anon_label_map(bids: List[dict]) -> dict:
    """Stable 'תאגיד N' label per corporation_id, numbered by the order
    their first bid arrived. Keeps the same corp looking like the same
    anonymous entity across re-renders."""
    out, n = {}, 0
    for b in bids:
        cid = b["corporation_id"]
        if cid not in out:
            n += 1
            out[cid] = f"תאגיד {n}"
    return out


# ── Contractor: create / list / detail ──────────────────────────────

@router.post("", status_code=201)
async def create_tender(
    data: TenderCreate,
    x_org_id: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    if x_user_role not in ("contractor", "admin"):
        raise HTTPException(status_code=403, detail="only_contractor_can_publish")
    if not x_org_id:
        raise HTTPException(status_code=400, detail="contractor_id required")
    if not data.items:
        raise HTTPException(status_code=400, detail="at_least_one_profession_required")

    tender_id = str(uuid.uuid4())
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO foreign_tenders
               (id, contractor_id, title, origin_country, region,
                target_start_date, notes, status)
               VALUES (%s,%s,%s,%s,%s,%s,%s,'open')""",
            (tender_id, x_org_id, data.title, data.origin_country, data.region,
             data.target_start_date or None, data.notes),
        )
        for it in data.items:
            cur.execute(
                """INSERT INTO foreign_tender_items
                   (id, tender_id, profession_type, quantity, min_experience, notes)
                   VALUES (%s,%s,%s,%s,%s,%s)""",
                (str(uuid.uuid4()), tender_id, it.profession_type, it.quantity,
                 it.min_experience, it.notes),
            )
        conn.commit()
        audit.log("foreign_tender", tender_id, "published", x_user_id or "unknown",
                  new_value={"items": len(data.items)})
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

    # Broadcast to corps (notification consumer fans out SMS to tier_2).
    await publish_event("tender.published", {
        "tender_id": tender_id,
        "contractor_id": x_org_id,
        "professions": [it.profession_type for it in data.items],
        "total_quantity": sum(it.quantity for it in data.items),
        "origin_country": data.origin_country,
    })
    return {"id": tender_id, "status": "open"}


@router.get("")
def list_my_tenders(
    x_org_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Contractor's own tenders (header rows + item summary + bid count)."""
    if x_user_role != "contractor" or not x_org_id:
        # Corps use /tenders/open; admins use /tenders/admin/all.
        return []
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM foreign_tenders WHERE contractor_id=%s ORDER BY created_at DESC",
            (x_org_id,),
        )
        rows = [_ser(r) for r in cur.fetchall()]
        for t in rows:
            t["items"] = _load_items(conn, t["id"])
            cur.execute(
                "SELECT COUNT(*) AS n FROM foreign_bids WHERE tender_id=%s AND status IN ('submitted','selected','confirmed')",
                (t["id"],),
            )
            t["bid_count"] = int(cur.fetchone()["n"])
        return rows
    finally:
        conn.close()


@router.get("/open")
def list_open_tenders(
    x_org_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Open tenders a corp can bid on. Contractor identity masked. Each
    tender carries a `my_bid` summary if this corp already bid."""
    if x_user_role != "corporation" or not x_org_id:
        return []
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM foreign_tenders WHERE status IN ('open','selecting') ORDER BY created_at DESC",
        )
        rows = [_ser(r) for r in cur.fetchall()]
        out = []
        for t in rows:
            # Double-blind: hide the contractor until revealed.
            if not t.get("revealed_at"):
                t["contractor_id"] = None
                t["contractor_anon"] = "קבלן"
            t["items"] = _load_items(conn, t["id"])
            cur.execute(
                "SELECT * FROM foreign_bids WHERE tender_id=%s AND corporation_id=%s ORDER BY submitted_at DESC LIMIT 1",
                (t["id"], x_org_id),
            )
            mine = cur.fetchone()
            t["my_bid"] = _ser(mine) if mine else None
            out.append(t)
        return out
    finally:
        conn.close()


@router.get("/my-bids")
def list_my_bids(
    x_org_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """A corp's bids across all tenders, with the tender header attached
    (contractor masked until reveal)."""
    if x_user_role != "corporation" or not x_org_id:
        return []
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM foreign_bids WHERE corporation_id=%s ORDER BY submitted_at DESC",
            (x_org_id,),
        )
        bids = [_ser(r) for r in cur.fetchall()]
        for b in bids:
            cur.execute("SELECT * FROM foreign_bid_items WHERE bid_id=%s", (b["id"],))
            b["items"] = [_ser(r) for r in cur.fetchall()]
            tender = _load_tender(conn, b["tender_id"])
            if tender:
                t = _ser(tender)
                if not t.get("revealed_at"):
                    t["contractor_id"] = None
                    t["contractor_anon"] = "קבלן"
                t["items"] = _load_items(conn, t["id"])
                b["tender"] = t
        return bids
    finally:
        conn.close()


@router.get("/{tender_id}")
def get_tender(
    tender_id: str,
    x_org_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Tender detail. Visibility:
       * contractor (owner): full tender + all bids, corps masked as
         'תאגיד N' until revealed.
       * corp: tender (contractor masked) + ONLY its own bid.
       * admin: everything unmasked.
    """
    conn = get_db()
    try:
        tender = _load_tender(conn, tender_id)
        if not tender:
            raise HTTPException(status_code=404, detail="tender_not_found")
        t = _ser(tender)
        t["items"] = _load_items(conn, tender_id)
        revealed = bool(tender.get("revealed_at"))

        is_admin       = x_user_role == "admin"
        is_owner       = x_user_role == "contractor" and x_org_id == tender["contractor_id"]
        is_corp        = x_user_role == "corporation"

        if is_admin:
            t["bids"] = _load_bids_with_items(conn, tender_id)
            return t

        if is_owner:
            bids = _load_bids_with_items(conn, tender_id)
            if not revealed:
                labels = _anon_label_map(bids)
                for b in bids:
                    b["corp_anon"] = labels[b["corporation_id"]]
                    b["corporation_id"] = None
            t["bids"] = bids
            return t

        if is_corp and x_org_id:
            # Corp sees the tender (contractor masked) + only its own bid.
            if not revealed:
                t["contractor_id"] = None
                t["contractor_anon"] = "קבלן"
            all_bids = _load_bids_with_items(conn, tender_id)
            t["bids"] = [b for b in all_bids if b["corporation_id"] == x_org_id]
            return t

        raise HTTPException(status_code=403, detail="forbidden")
    finally:
        conn.close()


# ── Corp: submit / withdraw bid ─────────────────────────────────────

@router.post("/{tender_id}/bids", status_code=201)
async def submit_bid(
    tender_id: str,
    data: BidCreate,
    x_org_id: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    if x_user_role != "corporation" or not x_org_id:
        raise HTTPException(status_code=403, detail="only_corporation_can_bid")
    if not data.items:
        raise HTTPException(status_code=400, detail="bid_must_offer_workers")

    conn = get_db()
    try:
        tender = _load_tender(conn, tender_id)
        if not tender:
            raise HTTPException(status_code=404, detail="tender_not_found")
        if tender["status"] not in ("open", "selecting"):
            raise HTTPException(status_code=409, detail="tender_not_accepting_bids")

        cur = conn.cursor()
        # One active bid per corp per tender — withdraw any prior live one.
        cur.execute(
            "UPDATE foreign_bids SET status='withdrawn' "
            "WHERE tender_id=%s AND corporation_id=%s AND status IN ('submitted','selected')",
            (tender_id, x_org_id),
        )
        bid_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO foreign_bids
               (id, tender_id, corporation_id, total_price, currency,
                delivery_estimate_days, notes, status, created_by_user_id)
               VALUES (%s,%s,%s,%s,%s,%s,%s,'submitted',%s)""",
            (bid_id, tender_id, x_org_id, data.total_price, data.currency,
             data.delivery_estimate_days, data.notes, x_user_id),
        )
        for it in data.items:
            cur.execute(
                """INSERT INTO foreign_bid_items
                   (id, bid_id, tender_item_id, profession_type, quantity_offered, unit_price)
                   VALUES (%s,%s,%s,%s,%s,%s)""",
                (str(uuid.uuid4()), bid_id, it.tender_item_id, it.profession_type,
                 it.quantity_offered, it.unit_price),
            )
        conn.commit()
        audit.log("foreign_bid", bid_id, "submitted", x_user_id or "unknown",
                  new_value={"tender_id": tender_id})
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

    await publish_event("tender.bid_submitted", {
        "tender_id": tender_id,
        "bid_id": bid_id,
        "corporation_id": x_org_id,
        "contractor_id": tender["contractor_id"],
    })
    return {"id": bid_id, "status": "submitted"}


@router.post("/{tender_id}/bids/withdraw")
def withdraw_bid(
    tender_id: str,
    x_org_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    if x_user_role != "corporation" or not x_org_id:
        raise HTTPException(status_code=403, detail="forbidden")
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE foreign_bids SET status='withdrawn' "
            "WHERE tender_id=%s AND corporation_id=%s AND status IN ('submitted','selected')",
            (tender_id, x_org_id),
        )
        conn.commit()
        return {"ok": True, "withdrawn": cur.rowcount}
    finally:
        conn.close()


# ── Contractor: select bids ─────────────────────────────────────────

@router.post("/{tender_id}/select")
async def select_bids(
    tender_id: str,
    data: SelectBids,
    x_org_id: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Contractor picks one or more bids. Marks them 'selected', resets
    any previously-selected-but-now-deselected bids back to 'submitted',
    and moves the tender to 'awaiting_admin' so the admin can approve +
    reveal. Re-callable until the admin approves."""
    conn = get_db()
    try:
        tender = _load_tender(conn, tender_id)
        if not tender:
            raise HTTPException(status_code=404, detail="tender_not_found")
        if x_user_role != "admin" and x_org_id != tender["contractor_id"]:
            raise HTTPException(status_code=403, detail="forbidden")
        if tender["status"] not in ("open", "selecting", "awaiting_admin"):
            raise HTTPException(status_code=409, detail="tender_locked")
        if not data.bid_ids:
            raise HTTPException(status_code=400, detail="select_at_least_one_bid")

        cur = conn.cursor()
        # Validate the bids belong to this tender + are live.
        fmt = ",".join(["%s"] * len(data.bid_ids))
        cur.execute(
            f"SELECT id FROM foreign_bids WHERE tender_id=%s AND id IN ({fmt}) "
            f"AND status IN ('submitted','selected')",
            (tender_id, *data.bid_ids),
        )
        valid = {r["id"] for r in cur.fetchall()}
        if len(valid) != len(set(data.bid_ids)):
            raise HTTPException(status_code=400, detail="invalid_bid_ids")

        # Reset selection: anything previously selected goes back to
        # submitted, then mark the chosen set selected.
        cur.execute(
            "UPDATE foreign_bids SET status='submitted', selected_at=NULL "
            "WHERE tender_id=%s AND status='selected'",
            (tender_id,),
        )
        cur.execute(
            f"UPDATE foreign_bids SET status='selected', selected_at=NOW() "
            f"WHERE id IN ({fmt})",
            tuple(data.bid_ids),
        )
        cur.execute(
            "UPDATE foreign_tenders SET status='awaiting_admin' WHERE id=%s",
            (tender_id,),
        )
        conn.commit()
        audit.log("foreign_tender", tender_id, "bids_selected", x_user_id or "unknown",
                  new_value={"bid_ids": data.bid_ids})
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

    await publish_event("tender.bids_selected", {
        "tender_id": tender_id,
        "bid_ids": data.bid_ids,
    })
    return {"ok": True, "status": "awaiting_admin"}


@router.post("/{tender_id}/cancel")
def cancel_tender(
    tender_id: str,
    x_org_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    conn = get_db()
    try:
        tender = _load_tender(conn, tender_id)
        if not tender:
            raise HTTPException(status_code=404, detail="tender_not_found")
        if x_user_role != "admin" and x_org_id != tender["contractor_id"]:
            raise HTTPException(status_code=403, detail="forbidden")
        cur = conn.cursor()
        cur.execute(
            "UPDATE foreign_tenders SET status='cancelled', cancelled_at=NOW() WHERE id=%s",
            (tender_id,),
        )
        cur.execute(
            "UPDATE foreign_bids SET status='rejected' "
            "WHERE tender_id=%s AND status IN ('submitted','selected')",
            (tender_id,),
        )
        conn.commit()
        return {"ok": True, "status": "cancelled"}
    finally:
        conn.close()


# ── Admin: oversight + approve/reveal ───────────────────────────────

@router.get("/admin/all")
def admin_list_tenders(
    x_user_role: Optional[str] = Header(default=None),
):
    if x_user_role != "admin":
        raise HTTPException(status_code=403, detail="admin_only")
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM foreign_tenders ORDER BY created_at DESC")
        rows = [_ser(r) for r in cur.fetchall()]
        for t in rows:
            t["items"] = _load_items(conn, t["id"])
            bids = _load_bids_with_items(conn, t["id"])
            t["bids"] = bids
            t["selected_bids"] = [b for b in bids if b["status"] in ("selected", "confirmed")]
        return rows
    finally:
        conn.close()


@router.post("/{tender_id}/admin/approve")
async def admin_approve(
    tender_id: str,
    x_user_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Admin confirms the contractor's selection, reveals identities to
    both sides, and moves the tender to in_progress. Selected bids →
    confirmed; everything else on the tender → rejected. Payment is
    arranged off-platform by the admin; this just records the reveal."""
    if x_user_role != "admin":
        raise HTTPException(status_code=403, detail="admin_only")
    conn = get_db()
    try:
        tender = _load_tender(conn, tender_id)
        if not tender:
            raise HTTPException(status_code=404, detail="tender_not_found")
        cur = conn.cursor()
        cur.execute(
            "SELECT id, corporation_id FROM foreign_bids WHERE tender_id=%s AND status='selected'",
            (tender_id,),
        )
        selected = cur.fetchall()
        if not selected:
            raise HTTPException(status_code=409, detail="no_selected_bids")

        cur.execute(
            "UPDATE foreign_bids SET status='confirmed', confirmed_at=NOW() "
            "WHERE tender_id=%s AND status='selected'",
            (tender_id,),
        )
        cur.execute(
            "UPDATE foreign_bids SET status='rejected' "
            "WHERE tender_id=%s AND status='submitted'",
            (tender_id,),
        )
        cur.execute(
            "UPDATE foreign_tenders SET status='in_progress', "
            "revealed_at=NOW(), revealed_by_user_id=%s WHERE id=%s",
            (x_user_id, tender_id),
        )
        conn.commit()
        audit.log("foreign_tender", tender_id, "admin_approved_revealed",
                  x_user_id or "admin",
                  new_value={"confirmed_corps": [r["corporation_id"] for r in selected]})
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

    await publish_event("tender.revealed", {
        "tender_id": tender_id,
        "contractor_id": tender["contractor_id"],
        "corporation_ids": [r["corporation_id"] for r in selected],
    })
    return {"ok": True, "status": "in_progress", "confirmed": len(selected)}


@router.post("/{tender_id}/admin/close")
def admin_close(
    tender_id: str,
    x_user_role: Optional[str] = Header(default=None),
):
    if x_user_role != "admin":
        raise HTTPException(status_code=403, detail="admin_only")
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE foreign_tenders SET status='closed', closed_at=NOW() WHERE id=%s",
            (tender_id,),
        )
        conn.commit()
        return {"ok": True, "status": "closed"}
    finally:
        conn.close()
