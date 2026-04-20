from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from decimal import Decimal
from typing import Optional
import uuid

from app.db import get_db

router = APIRouter()


# ── helpers ────────────────────────────────────────────────────────────────

def _serialize(row: dict) -> dict:
    """Convert date/datetime/Decimal values to JSON-serialisable types."""
    for k, v in row.items():
        if hasattr(v, 'isoformat'):
            row[k] = v.isoformat()
        elif isinstance(v, Decimal):
            row[k] = float(v)
    return row


def _load_deal_party_names(conn, contractor_id: str, corporation_id: str) -> dict:
    """Fetch both parties of a deal in a single round-trip (UNION ALL across tables)."""
    cur = conn.cursor()
    cur.execute(
        """SELECT id, company_name_he, company_name, 'contractor' AS kind
             FROM contractors WHERE id=%s
           UNION ALL
           SELECT id, company_name_he, company_name, 'corporation' AS kind
             FROM corporations WHERE id=%s""",
        (contractor_id, corporation_id),
    )
    names: dict = {}
    for row in cur.fetchall():
        names[row["id"]] = row.get("company_name_he") or row.get("company_name") or row["id"][:8]
    return names


# ── GET /admin/deals/:id ──────────────────────────────────────────────────

@router.get("/deals/{deal_id}")
def get_deal_detail(deal_id: str):
    deal_conn = get_db("deal_db")
    org_conn  = get_db("org_db")
    try:
        deal_cur = deal_conn.cursor()

        # Deal row
        deal_cur.execute(
            "SELECT * FROM deals WHERE id=%s AND deleted_at IS NULL", (deal_id,)
        )
        deal = deal_cur.fetchone()
        if not deal:
            raise HTTPException(status_code=404, detail="Deal not found")
        deal = _serialize(deal)

        # Resolve both party names in one round-trip.
        party_names = _load_deal_party_names(org_conn, deal["contractor_id"], deal["corporation_id"])
        deal["contractor_name"]  = party_names.get(deal["contractor_id"], deal["contractor_id"][:8])
        deal["corporation_name"] = party_names.get(deal["corporation_id"], deal["corporation_id"][:8])

        # Reports (both parties)
        deal_cur.execute(
            "SELECT * FROM deal_reports WHERE deal_id=%s ORDER BY reported_by", (deal_id,)
        )
        reports = [_serialize(r) for r in deal_cur.fetchall()]
        deal["reports"] = reports

        # Commission (may be None)
        deal_cur.execute(
            "SELECT * FROM commissions WHERE deal_id=%s", (deal_id,)
        )
        commission_row = deal_cur.fetchone()
        deal["commission"] = _serialize(commission_row) if commission_row else None

        # Workers
        deal_cur.execute(
            "SELECT worker_id AS id, assigned_at FROM deal_workers WHERE deal_id=%s AND removed_at IS NULL",
            (deal_id,)
        )
        deal["workers"] = [_serialize(w) for w in deal_cur.fetchall()]

        return deal
    finally:
        deal_conn.close()
        org_conn.close()


# ── POST /admin/deals/:id/commission ─────────────────────────────────────

class CommissionInput(BaseModel):
    gross_amount: Decimal
    commission_rate: Decimal          # e.g. 0.05 = 5 %
    invoice_number: Optional[str] = None
    invoice_date: Optional[str] = None
    invoice_url: Optional[str] = None
    notes: Optional[str] = None


@router.post("/deals/{deal_id}/commission", status_code=201)
def create_commission(
    deal_id: str,
    body: CommissionInput,
    x_user_id: Optional[str] = Header(default=None),
):
    admin_user = x_user_id or "admin"
    commission_id = str(uuid.uuid4())
    commission_amount = (body.gross_amount * body.commission_rate).quantize(Decimal("0.01"))

    conn = get_db("deal_db")
    try:
        cur = conn.cursor()

        # Guard: deal must exist and be completed/reporting
        cur.execute(
            "SELECT status FROM deals WHERE id=%s AND deleted_at IS NULL", (deal_id,)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Deal not found")
        if row["status"] not in ("completed", "reporting", "disputed"):
            raise HTTPException(
                status_code=400,
                detail=f"Cannot set commission on a deal with status '{row['status']}'"
            )

        # Guard: no duplicate
        cur.execute("SELECT id FROM commissions WHERE deal_id=%s", (deal_id,))
        if cur.fetchone():
            raise HTTPException(status_code=409, detail="Commission already exists for this deal")

        cur.execute(
            """INSERT INTO commissions
               (id, deal_id, gross_amount, commission_rate, commission_amount,
                invoice_number, invoice_date, invoice_url, notes, created_by, status)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'pending')""",
            (commission_id, deal_id, body.gross_amount, body.commission_rate,
             commission_amount, body.invoice_number, body.invoice_date,
             body.invoice_url, body.notes, admin_user),
        )
        conn.commit()

        return {
            "id": commission_id,
            "deal_id": deal_id,
            "gross_amount": float(body.gross_amount),
            "commission_rate": float(body.commission_rate),
            "commission_amount": float(commission_amount),
            "status": "pending",
        }
    finally:
        conn.close()


# ── PATCH /admin/commissions/:commission_id/status ───────────────────────

class StatusUpdate(BaseModel):
    status: str
    invoice_number: Optional[str] = None
    invoice_date: Optional[str] = None
    invoice_url: Optional[str] = None


VALID_STATUSES = {"pending", "invoiced", "paid", "disputed"}


@router.patch("/commissions/{commission_id}/status")
def update_commission_status(commission_id: str, body: StatusUpdate):
    if body.status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {', '.join(VALID_STATUSES)}")

    conn = get_db("deal_db")
    try:
        cur = conn.cursor()
        cur.execute("SELECT id FROM commissions WHERE id=%s", (commission_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Commission not found")

        updates = ["status=%s"]
        params: list = [body.status]
        if body.invoice_number:
            updates.append("invoice_number=%s"); params.append(body.invoice_number)
        if body.invoice_date:
            updates.append("invoice_date=%s"); params.append(body.invoice_date)
        if body.invoice_url:
            updates.append("invoice_url=%s"); params.append(body.invoice_url)

        params.append(commission_id)
        cur.execute(
            f"UPDATE commissions SET {', '.join(updates)} WHERE id=%s", params
        )
        conn.commit()
        return {"id": commission_id, "status": body.status}
    finally:
        conn.close()


# ── Corporation commission-rate endpoints ─────────────────────────────────

class CommissionRateInput(BaseModel):
    commission_per_worker_amount: Decimal
    currency: str = "ILS"


@router.get("/corporations/{corp_id}/commission")
def get_corporation_commission(corp_id: str):
    """Return the current per-worker commission settings for a corporation."""
    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id FROM corporations WHERE id=%s AND deleted_at IS NULL",
            (corp_id,)
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Corporation not found")

        cur.execute(
            """SELECT commission_per_worker_amount, commission_currency,
                      commission_set_by_user_id, commission_set_at
               FROM corporations WHERE id=%s""",
            (corp_id,)
        )
        row = cur.fetchone()
        return {
            "corporation_id":                corp_id,
            "commission_per_worker_amount":  float(row["commission_per_worker_amount"]) if row["commission_per_worker_amount"] is not None else None,
            "currency":                      row["commission_currency"],
            "commission_set_by_user_id":     row["commission_set_by_user_id"],
            "commission_set_at":             row["commission_set_at"].isoformat() if row["commission_set_at"] else None,
        }
    finally:
        conn.close()


@router.patch("/corporations/{corp_id}/commission")
def set_corporation_commission(
    corp_id: str,
    body: CommissionRateInput,
    x_user_id: Optional[str] = Header(default=None),
):
    """Set the per-worker commission rate for a corporation."""
    conn = get_db("org_db")
    try:
        cur = conn.cursor()

        # Guard: corporation must exist and not be deleted
        cur.execute(
            "SELECT id FROM corporations WHERE id=%s AND deleted_at IS NULL",
            (corp_id,)
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Corporation not found")

        cur.execute(
            """UPDATE corporations
               SET commission_per_worker_amount=%s,
                   commission_currency=%s,
                   commission_set_by_user_id=%s,
                   commission_set_at=NOW()
               WHERE id=%s""",
            (body.commission_per_worker_amount, body.currency, x_user_id, corp_id)
        )
        conn.commit()

        return {
            "corporation_id":               corp_id,
            "commission_per_worker_amount": float(body.commission_per_worker_amount),
            "currency":                     body.currency,
        }
    finally:
        conn.close()
