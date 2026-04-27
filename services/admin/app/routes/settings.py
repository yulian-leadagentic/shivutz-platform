"""Admin endpoints for system-wide settings: VAT periods, etc."""
from datetime import date as date_t
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel

from app.db import get_db

router = APIRouter()


def _serialize(row: dict) -> dict:
    for k, v in list(row.items()):
        if isinstance(v, Decimal):
            row[k] = float(v)
        elif hasattr(v, "isoformat"):
            row[k] = v.isoformat()
    return row


# ── VAT periods ─────────────────────────────────────────────────────────────


class VATPeriodIn(BaseModel):
    percent: float                 # e.g. 18.0 (a number, not a fraction)
    valid_from: str                # ISO date 'YYYY-MM-DD'
    valid_until: Optional[str] = None  # NULL = open-ended
    notes: Optional[str] = None


@router.get("/vat-periods")
def list_vat_periods():
    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT id, percent, valid_from, valid_until, notes,
                      created_at, created_by_user_id
               FROM vat_periods
               ORDER BY valid_from DESC"""
        )
        return [_serialize(r) for r in cur.fetchall()]
    finally:
        conn.close()


@router.post("/vat-periods", status_code=201)
def add_vat_period(body: VATPeriodIn, x_user_id: Optional[str] = Header(default=None)):
    if body.percent < 0 or body.percent > 100:
        raise HTTPException(status_code=400, detail="percent_out_of_range")
    if body.valid_until and body.valid_until < body.valid_from:
        raise HTTPException(status_code=400, detail="valid_until_before_valid_from")

    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO vat_periods
                 (percent, valid_from, valid_until, notes, created_by_user_id)
               VALUES (%s, %s, %s, %s, %s)""",
            (body.percent, body.valid_from, body.valid_until, body.notes,
             x_user_id or "admin"),
        )
        conn.commit()
        # Return the newly-created row.
        cur.execute(
            "SELECT id, percent, valid_from, valid_until, notes, created_at "
            "FROM vat_periods ORDER BY created_at DESC LIMIT 1"
        )
        return _serialize(cur.fetchone())
    finally:
        conn.close()


@router.delete("/vat-periods/{period_id}", status_code=204)
def delete_vat_period(period_id: str):
    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM vat_periods WHERE id=%s", (period_id,))
        conn.commit()
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="period_not_found")
    finally:
        conn.close()
