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
    origin_country: Optional[str] = None    # per-line origin preference
    min_experience: int = 0
    notes: Optional[str] = None


class TenderCreate(BaseModel):
    title: Optional[str] = None
    target_start_date: Optional[str] = None
    notes: Optional[str] = None
    items: List[TenderItemIn]
    # region dropped from the foreign flow — accepted-but-ignored for
    # any stale client.
    origin_country: Optional[str] = None
    region: Optional[str] = None


class BidItemIn(BaseModel):
    tender_item_id: str
    profession_type: str
    quantity_offered: int
    hourly_rate: Optional[float] = None      # ₪/hour for this line


class BidCreate(BaseModel):
    arrival_date: Optional[str] = None       # when workers reach Israel
    currency: str = "ILS"
    notes: Optional[str] = None
    # QA-R3 #20: housing included in the hourly rate? `None` = corp didn't
    # specify (older bids before this field existed); True/False after this
    # change. `housing_notes` lets the corp add a caveat ("מגורים בחיפה
    # בלבד", "כולל ארוחות בוקר", ...).
    includes_housing: Optional[bool] = None
    housing_notes: Optional[str] = None
    items: List[BidItemIn]


class SelectLines(BaseModel):
    # Contractor picks individual offer LINES (bid_item ids), not whole
    # bids — different corps can win different professions.
    bid_item_ids: List[str]


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
        b["items"] = [_bid_item(r) for r in cur.fetchall()]
    return bids


def _bid_item(row: dict) -> dict:
    """Serialize a bid line, aliasing the unit_price column to
    `hourly_rate` (its real meaning) + exposing `selected` as bool."""
    out = _ser(row)
    out["hourly_rate"] = out.get("unit_price")
    out["selected"] = bool(out.get("selected"))
    return out


def _corp_ref_no(conn, tender_id: str, corp_id: str) -> int:
    """Anonymous per-corp running number for a tender. Returns the
    existing ref or assigns the next sequential number for this corp.
    Lets the corp see "בקשה מספר N" without ever learning the
    contractor's title."""
    cur = conn.cursor()
    cur.execute(
        "SELECT ref_no FROM foreign_tender_corp_ref WHERE tender_id=%s AND corporation_id=%s",
        (tender_id, corp_id),
    )
    row = cur.fetchone()
    if row:
        return int(row["ref_no"])
    cur.execute(
        "SELECT COALESCE(MAX(ref_no),0)+1 AS n FROM foreign_tender_corp_ref WHERE corporation_id=%s",
        (corp_id,),
    )
    nxt = int(cur.fetchone()["n"])
    try:
        cur.execute(
            "INSERT INTO foreign_tender_corp_ref (id, tender_id, corporation_id, ref_no) VALUES (%s,%s,%s,%s)",
            (str(uuid.uuid4()), tender_id, corp_id, nxt),
        )
        conn.commit()
    except Exception:
        # Race: another request assigned it first — re-read.
        conn.rollback()
        cur.execute(
            "SELECT ref_no FROM foreign_tender_corp_ref WHERE tender_id=%s AND corporation_id=%s",
            (tender_id, corp_id),
        )
        r = cur.fetchone()
        nxt = int(r["ref_no"]) if r else nxt
    return nxt


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
        # Created in 'pending_admin' — NOT broadcast yet. The admin must
        # approve it for publishing first (see /admin/publish below).
        cur.execute(
            """INSERT INTO foreign_tenders
               (id, contractor_id, title, target_start_date, notes, status)
               VALUES (%s,%s,%s,%s,%s,'pending_admin')""",
            (tender_id, x_org_id, data.title,
             data.target_start_date or None, data.notes),
        )
        for it in data.items:
            cur.execute(
                """INSERT INTO foreign_tender_items
                   (id, tender_id, profession_type, origin_country, quantity, min_experience, notes)
                   VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                (str(uuid.uuid4()), tender_id, it.profession_type, it.origin_country,
                 it.quantity, it.min_experience, it.notes),
            )
        conn.commit()
        audit.log("foreign_tender", tender_id, "created_pending_admin", x_user_id or "unknown",
                  new_value={"items": len(data.items)})
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

    # Tell admins a tender is waiting for publish approval (no corp
    # broadcast yet — that happens on admin publish).
    await publish_event("tender.pending_admin", {
        "tender_id": tender_id,
        "contractor_id": x_org_id,
        "professions": [it.profession_type for it in data.items],
        "total_quantity": sum(it.quantity for it in data.items),
    })
    return {"id": tender_id, "status": "pending_admin"}


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
            "SELECT * FROM foreign_tenders WHERE status='open' ORDER BY created_at DESC",
        )
        rows = [_ser(r) for r in cur.fetchall()]
        out = []
        for t in rows:
            # Double-blind: hide the contractor + title until revealed.
            if not t.get("revealed_at"):
                t["contractor_id"] = None
                t["contractor_anon"] = "קבלן"
                t["title"] = None
            t["ref_no"] = _corp_ref_no(conn, t["id"], x_org_id)
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
            b["items"] = [_bid_item(r) for r in cur.fetchall()]
            tender = _load_tender(conn, b["tender_id"])
            if tender:
                t = _ser(tender)
                if not t.get("revealed_at"):
                    t["contractor_id"] = None
                    t["contractor_anon"] = "קבלן"
                    t["title"] = None
                t["ref_no"] = _corp_ref_no(conn, t["id"], x_org_id)
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
            # The contractor only ever sees admin-APPROVED bids. A bid
            # sitting in 'pending_admin' (or rejected/withdrawn) is hidden.
            bids = [b for b in _load_bids_with_items(conn, tender_id)
                    if b["status"] in ("submitted", "selected", "confirmed")]
            if not revealed:
                labels = _anon_label_map(bids)
                for b in bids:
                    b["corp_anon"] = labels[b["corporation_id"]]
                    b["corporation_id"] = None
            t["bids"] = bids
            return t

        if is_corp and x_org_id:
            # Corp sees the tender (contractor + title masked) + only
            # its own bid, plus its anonymous per-corp request number.
            if not revealed:
                t["contractor_id"] = None
                t["contractor_anon"] = "קבלן"
                t["title"] = None
            t["ref_no"] = _corp_ref_no(conn, tender_id, x_org_id)
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
    # Every offered line must carry an hourly rate. Return the offending
    # profession codes so the frontend can build a Hebrew message like
    # "לא הוזן מחיר שעת עבודה לעובדי הריצוף מסין".
    missing = [it.profession_type for it in data.items
               if it.quantity_offered and (it.hourly_rate is None or it.hourly_rate <= 0)]
    if missing:
        raise HTTPException(status_code=400,
                            detail={"code": "missing_hourly_rate", "professions": missing})

    conn = get_db()
    try:
        tender = _load_tender(conn, tender_id)
        if not tender:
            raise HTTPException(status_code=404, detail="tender_not_found")
        if tender["status"] != "open":
            raise HTTPException(status_code=409, detail="tender_not_accepting_bids")

        cur = conn.cursor()
        # One active bid per corp per tender — withdraw any prior live one
        # (including one still pending admin approval).
        cur.execute(
            "UPDATE foreign_bids SET status='withdrawn' "
            "WHERE tender_id=%s AND corporation_id=%s AND status IN ('pending_admin','submitted','selected')",
            (tender_id, x_org_id),
        )
        bid_id = str(uuid.uuid4())
        # Bid lands as 'pending_admin' — INVISIBLE to the contractor until
        # the admin approves it (see admin_approve_bid). Pricing is
        # per-line hourly so total_price stays NULL; arrival_date stored.
        cur.execute(
            """INSERT INTO foreign_bids
               (id, tender_id, corporation_id, currency,
                arrival_date, notes, includes_housing, housing_notes,
                status, created_by_user_id)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'pending_admin',%s)""",
            (bid_id, tender_id, x_org_id, data.currency,
             data.arrival_date or None, data.notes,
             # MySQL TINYINT(1) accepts 0/1/NULL; cast for clarity.
             None if data.includes_housing is None else int(data.includes_housing),
             (data.housing_notes or None) if data.includes_housing is not None else None,
             x_user_id),
        )
        for it in data.items:
            # unit_price column carries the per-line HOURLY rate.
            cur.execute(
                """INSERT INTO foreign_bid_items
                   (id, bid_id, tender_item_id, profession_type, quantity_offered, unit_price)
                   VALUES (%s,%s,%s,%s,%s,%s)""",
                (str(uuid.uuid4()), bid_id, it.tender_item_id, it.profession_type,
                 it.quantity_offered, it.hourly_rate),
            )
        conn.commit()
        audit.log("foreign_bid", bid_id, "submitted_pending_admin", x_user_id or "unknown",
                  new_value={"tender_id": tender_id})
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

    # Admin-facing only (not bound → no SMS). The contractor is notified
    # later, when the admin APPROVES the bid (publishes tender.bid_submitted).
    await publish_event("tender.bid_pending_admin", {
        "tender_id": tender_id,
        "bid_id": bid_id,
        "corporation_id": x_org_id,
    })
    return {"id": bid_id, "status": "pending_admin"}


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
            "WHERE tender_id=%s AND corporation_id=%s AND status IN ('pending_admin','submitted','selected')",
            (tender_id, x_org_id),
        )
        conn.commit()
        return {"ok": True, "withdrawn": cur.rowcount}
    finally:
        conn.close()


# ── Admin: per-bid approval gate ────────────────────────────────────
# A corp's bid lands as 'pending_admin' and is invisible to the
# contractor. The admin reviews it and either approves it (→ 'submitted',
# now visible + contractor notified) or rejects it with a reason.

class BidReject(BaseModel):
    reason: Optional[str] = None


@router.post("/{tender_id}/bids/{bid_id}/admin/approve")
async def admin_approve_bid(
    tender_id: str,
    bid_id: str,
    x_user_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    if x_user_role != "admin":
        raise HTTPException(status_code=403, detail="admin_only")
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM foreign_bids WHERE id=%s AND tender_id=%s",
            (bid_id, tender_id),
        )
        bid = cur.fetchone()
        if not bid:
            raise HTTPException(status_code=404, detail="bid_not_found")
        if bid["status"] != "pending_admin":
            raise HTTPException(status_code=409, detail="bid_not_pending")
        cur.execute(
            "UPDATE foreign_bids SET status='submitted', approved_at=NOW(), "
            "approved_by_user_id=%s WHERE id=%s",
            (x_user_id, bid_id),
        )
        conn.commit()
        tender = _load_tender(conn, tender_id)
        audit.log("foreign_bid", bid_id, "admin_approved", x_user_id or "admin")
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

    # Now visible to the contractor — reuse the existing "new bid" SMS.
    await publish_event("tender.bid_submitted", {
        "tender_id": tender_id,
        "bid_id": bid_id,
        "corporation_id": bid["corporation_id"],
        "contractor_id": tender["contractor_id"] if tender else None,
    })
    return {"ok": True, "status": "submitted"}


@router.post("/{tender_id}/bids/{bid_id}/admin/reject")
async def admin_reject_bid(
    tender_id: str,
    bid_id: str,
    data: BidReject,
    x_user_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    if x_user_role != "admin":
        raise HTTPException(status_code=403, detail="admin_only")
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id FROM foreign_bids WHERE id=%s AND tender_id=%s",
            (bid_id, tender_id),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="bid_not_found")
        cur.execute(
            "UPDATE foreign_bids SET status='rejected', rejection_reason=%s, "
            "rejected_at=NOW(), rejected_by_user_id=%s WHERE id=%s",
            (data.reason or None, x_user_id, bid_id),
        )
        conn.commit()
        audit.log("foreign_bid", bid_id, "admin_rejected", x_user_id or "admin",
                  new_value={"reason": data.reason})
        return {"ok": True, "status": "rejected"}
    finally:
        conn.close()


# ── Contractor: select offer LINES + send contact request ──────────

@router.post("/{tender_id}/select")
async def select_lines(
    tender_id: str,
    data: SelectLines,
    x_org_id: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Contractor picks individual offer LINES (bid_item ids) — different
    corps can win different professions. Marks those bid_items selected
    (+ their parent bids), clears any deselected lines, and moves the
    tender to 'awaiting_admin' (the contact request the admin must
    approve before identities are revealed). Re-callable until approval."""
    conn = get_db()
    try:
        tender = _load_tender(conn, tender_id)
        if not tender:
            raise HTTPException(status_code=404, detail="tender_not_found")
        if x_user_role != "admin" and x_org_id != tender["contractor_id"]:
            raise HTTPException(status_code=403, detail="forbidden")
        if tender["status"] not in ("open", "awaiting_admin"):
            raise HTTPException(status_code=409, detail="tender_locked")
        if not data.bid_item_ids:
            raise HTTPException(status_code=400, detail="select_at_least_one_line")

        cur = conn.cursor()
        # Validate every chosen line belongs to a live bid on this tender.
        fmt = ",".join(["%s"] * len(data.bid_item_ids))
        cur.execute(
            f"""SELECT bi.id, bi.bid_id FROM foreign_bid_items bi
                  JOIN foreign_bids b ON b.id = bi.bid_id
                 WHERE b.tender_id=%s AND bi.id IN ({fmt})
                   AND b.status IN ('submitted','selected')""",
            (tender_id, *data.bid_item_ids),
        )
        valid_rows = cur.fetchall()
        if len(valid_rows) != len(set(data.bid_item_ids)):
            raise HTTPException(status_code=400, detail="invalid_line_ids")
        winning_bid_ids = {r["bid_id"] for r in valid_rows}

        # Clear all line selections on this tender, then set the chosen.
        cur.execute(
            """UPDATE foreign_bid_items bi
                  JOIN foreign_bids b ON b.id = bi.bid_id
                 SET bi.selected=0
               WHERE b.tender_id=%s""",
            (tender_id,),
        )
        cur.execute(
            f"UPDATE foreign_bid_items SET selected=1 WHERE id IN ({fmt})",
            tuple(data.bid_item_ids),
        )
        # A bid is 'selected' iff it has at least one selected line.
        cur.execute(
            "UPDATE foreign_bids SET status='submitted', selected_at=NULL "
            "WHERE tender_id=%s AND status='selected'",
            (tender_id,),
        )
        if winning_bid_ids:
            bfmt = ",".join(["%s"] * len(winning_bid_ids))
            cur.execute(
                f"UPDATE foreign_bids SET status='selected', selected_at=NOW() "
                f"WHERE id IN ({bfmt})",
                tuple(winning_bid_ids),
            )
        cur.execute(
            "UPDATE foreign_tenders SET status='awaiting_admin' WHERE id=%s",
            (tender_id,),
        )
        conn.commit()
        audit.log("foreign_tender", tender_id, "lines_selected", x_user_id or "unknown",
                  new_value={"bid_item_ids": data.bid_item_ids})
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

    # Notify admins a contact request is awaiting approval.
    await publish_event("tender.contact_requested", {
        "tender_id": tender_id,
        "bid_item_ids": data.bid_item_ids,
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


class TenderEdit(BaseModel):
    title: Optional[str] = None
    target_start_date: Optional[str] = None
    notes: Optional[str] = None
    items: Optional[List[TenderItemIn]] = None


def _bid_count(conn, tender_id: str) -> int:
    cur = conn.cursor()
    cur.execute(
        "SELECT COUNT(*) AS n FROM foreign_bids WHERE tender_id=%s "
        "AND status IN ('submitted','selected','confirmed')",
        (tender_id,),
    )
    return int(cur.fetchone()["n"])


@router.patch("/{tender_id}")
def edit_tender(
    tender_id: str,
    data: TenderEdit,
    x_org_id: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Edit a request.
       * Owner: allowed only while still editable (status pending_admin
         or open) AND no live bids yet. Can edit everything incl. items.
       * Admin: can edit title/notes any time (to SCRUB PII the
         contractor may have typed — phone, company name — keeping the
         request anonymous). Items only when there are no bids."""
    conn = get_db()
    try:
        tender = _load_tender(conn, tender_id)
        if not tender:
            raise HTTPException(status_code=404, detail="tender_not_found")
        is_admin = x_user_role == "admin"
        is_owner = x_org_id == tender["contractor_id"]
        if not is_admin and not is_owner:
            raise HTTPException(status_code=403, detail="forbidden")

        has_bids = _bid_count(conn, tender_id) > 0
        if not is_admin:
            if tender["status"] not in ("pending_admin", "open"):
                raise HTTPException(status_code=409, detail="not_editable")
            if has_bids:
                raise HTTPException(status_code=409, detail="has_responses_cannot_edit")

        cur = conn.cursor()
        sets, params = [], []
        if data.title is not None:               sets.append("title=%s");             params.append(data.title or None)
        if data.target_start_date is not None:   sets.append("target_start_date=%s"); params.append(data.target_start_date or None)
        if data.notes is not None:               sets.append("notes=%s");             params.append(data.notes or None)
        if sets:
            cur.execute(f"UPDATE foreign_tenders SET {', '.join(sets)} WHERE id=%s", (*params, tender_id))

        # Items can only be replaced when there are no bids (their ids
        # are referenced by bid lines).
        if data.items is not None:
            if has_bids:
                raise HTTPException(status_code=409, detail="has_responses_cannot_edit_items")
            cur.execute("DELETE FROM foreign_tender_items WHERE tender_id=%s", (tender_id,))
            for it in data.items:
                cur.execute(
                    """INSERT INTO foreign_tender_items
                       (id, tender_id, profession_type, origin_country, quantity, min_experience, notes)
                       VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                    (str(uuid.uuid4()), tender_id, it.profession_type, it.origin_country,
                     it.quantity, it.min_experience, it.notes),
                )
        conn.commit()
        audit.log("foreign_tender", tender_id, "edited", x_user_id or "unknown",
                  new_value={"by": "admin" if is_admin else "owner"})
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@router.delete("/{tender_id}")
def delete_tender(
    tender_id: str,
    x_org_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Hard-delete a request (owner or admin). CASCADE removes items,
    bids, bid lines and per-corp refs. Pre-launch — no soft-delete."""
    conn = get_db()
    try:
        tender = _load_tender(conn, tender_id)
        if not tender:
            raise HTTPException(status_code=404, detail="tender_not_found")
        if x_user_role != "admin" and x_org_id != tender["contractor_id"]:
            raise HTTPException(status_code=403, detail="forbidden")
        cur = conn.cursor()
        cur.execute("DELETE FROM foreign_tenders WHERE id=%s", (tender_id,))
        conn.commit()
        return {"ok": True, "deleted": True}
    finally:
        conn.close()


@router.post("/{tender_id}/freeze")
def freeze_tender(
    tender_id: str,
    x_org_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Freeze a published request — hidden from corps (status filter
    excludes 'frozen') but kept + restorable. Owner or admin."""
    conn = get_db()
    try:
        tender = _load_tender(conn, tender_id)
        if not tender:
            raise HTTPException(status_code=404, detail="tender_not_found")
        if x_user_role != "admin" and x_org_id != tender["contractor_id"]:
            raise HTTPException(status_code=403, detail="forbidden")
        if tender["status"] not in ("open", "pending_admin"):
            raise HTTPException(status_code=409, detail="cannot_freeze")
        cur = conn.cursor()
        cur.execute(
            "UPDATE foreign_tenders SET status='frozen', frozen_at=NOW() WHERE id=%s",
            (tender_id,),
        )
        conn.commit()
        return {"ok": True, "status": "frozen"}
    finally:
        conn.close()


@router.post("/{tender_id}/unfreeze")
def unfreeze_tender(
    tender_id: str,
    x_org_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Restore a frozen request back to 'open'."""
    conn = get_db()
    try:
        tender = _load_tender(conn, tender_id)
        if not tender:
            raise HTTPException(status_code=404, detail="tender_not_found")
        if x_user_role != "admin" and x_org_id != tender["contractor_id"]:
            raise HTTPException(status_code=403, detail="forbidden")
        if tender["status"] != "frozen":
            raise HTTPException(status_code=409, detail="not_frozen")
        cur = conn.cursor()
        cur.execute(
            "UPDATE foreign_tenders SET status='open', frozen_at=NULL WHERE id=%s",
            (tender_id,),
        )
        conn.commit()
        return {"ok": True, "status": "open"}
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
            # Attach each corp's anonymous per-corp request number so the
            # admin can map "תאגיד X → בקשה מספר N" back to this tender.
            cur.execute(
                "SELECT corporation_id, ref_no FROM foreign_tender_corp_ref WHERE tender_id=%s",
                (t["id"],),
            )
            ref_map = {r["corporation_id"]: int(r["ref_no"]) for r in cur.fetchall()}
            for b in bids:
                b["corp_ref_no"] = ref_map.get(b["corporation_id"])
            t["bids"] = bids
            t["selected_bids"] = [b for b in bids if b["status"] in ("selected", "confirmed")]
        return rows
    finally:
        conn.close()


@router.get("/admin/summary")
def admin_summary(x_user_role: Optional[str] = Header(default=None)):
    """Lightweight counts for the admin dashboard widget — how many
    foreign-import requests sit in each actionable bucket."""
    if x_user_role != "admin":
        raise HTTPException(status_code=403, detail="admin_only")
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT
                 SUM(status='pending_admin')  AS pending_publish,
                 SUM(status='open')           AS open_for_bids,
                 SUM(status='awaiting_admin') AS awaiting_contact,
                 SUM(status='in_progress')    AS in_progress
               FROM foreign_tenders"""
        )
        r = cur.fetchone() or {}
        return {k: int(r.get(k) or 0) for k in
                ("pending_publish", "open_for_bids", "awaiting_contact", "in_progress")}
    finally:
        conn.close()


@router.post("/{tender_id}/admin/publish")
async def admin_publish(
    tender_id: str,
    x_user_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Gate 1 — admin approves a pending tender for broadcast. Flips
    pending_admin → open and fans the tender out to corps for bidding.
    Until this runs, corps never see the tender."""
    if x_user_role != "admin":
        raise HTTPException(status_code=403, detail="admin_only")
    conn = get_db()
    try:
        tender = _load_tender(conn, tender_id)
        if not tender:
            raise HTTPException(status_code=404, detail="tender_not_found")
        if tender["status"] != "pending_admin":
            raise HTTPException(status_code=409, detail="not_pending_publish")
        cur = conn.cursor()
        cur.execute("UPDATE foreign_tenders SET status='open' WHERE id=%s", (tender_id,))
        conn.commit()
        items = _load_items(conn, tender_id)
        audit.log("foreign_tender", tender_id, "admin_published", x_user_id or "admin")
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

    # NOW broadcast to corps (notification consumer fans out SMS).
    await publish_event("tender.published", {
        "tender_id": tender_id,
        "contractor_id": tender["contractor_id"],
        "professions": [it["profession_type"] for it in items],
        "total_quantity": sum(it["quantity"] for it in items),
    })
    return {"ok": True, "status": "open"}


class RejectReason(BaseModel):
    reason: Optional[str] = None


@router.post("/{tender_id}/admin/reject")
async def admin_reject(
    tender_id: str,
    data: RejectReason,
    x_user_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Admin rejects a request (at the publish gate or later) with an
    optional free-text reason. Status → 'rejected'; live bids voided."""
    if x_user_role != "admin":
        raise HTTPException(status_code=403, detail="admin_only")
    conn = get_db()
    try:
        tender = _load_tender(conn, tender_id)
        if not tender:
            raise HTTPException(status_code=404, detail="tender_not_found")
        cur = conn.cursor()
        cur.execute(
            "UPDATE foreign_tenders SET status='rejected', rejection_reason=%s, "
            "rejected_at=NOW(), rejected_by_user_id=%s WHERE id=%s",
            (data.reason or None, x_user_id, tender_id),
        )
        cur.execute(
            "UPDATE foreign_bids SET status='rejected' "
            "WHERE tender_id=%s AND status IN ('submitted','selected')",
            (tender_id,),
        )
        conn.commit()
        audit.log("foreign_tender", tender_id, "admin_rejected", x_user_id or "admin",
                  new_value={"reason": data.reason})
        return {"ok": True, "status": "rejected"}
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
            "WHERE tender_id=%s AND status IN ('submitted','pending_admin')",
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
