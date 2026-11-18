"""VAT on top of every price (fixes list ג, item 6; Yulian, 18.11).

Every price in the system is before VAT. A charge is the price plus VAT
at the rate in force on the day of the charge, Israel time, read from
payment_db.vat_periods: the one place the rate lives, edited from the
admin settings page (migration 017). No rate is written in code; with no
period in force there is no charge (`vat_period_missing`).

user-org has the same lookup for the provider quote and purchase row
(user-org/app/services/vat.py). Both round VAT to the agora, half up.
"""
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional
from zoneinfo import ZoneInfo

from app.db import get_db

_IL = ZoneInfo("Asia/Jerusalem")
_AGORA = Decimal("0.01")


class VatPeriodMissing(RuntimeError):
    """No VAT period covers the day. Nothing may be charged."""


def percent_on(day: Optional[date] = None, cur=None) -> Decimal:
    day = day or datetime.now(_IL).date()
    sql = ("SELECT percent FROM payment_db.vat_periods "
           "WHERE valid_from <= %s AND (valid_until IS NULL OR valid_until >= %s) "
           "ORDER BY valid_from DESC LIMIT 1")
    if cur is not None:
        cur.execute(sql, (day, day))
        row = cur.fetchone()
    else:
        conn = get_db("payment_db")
        try:
            c = conn.cursor()
            c.execute(sql, (day, day))
            row = c.fetchone()
        finally:
            conn.close()
    if not row or row.get("percent") is None:
        raise VatPeriodMissing(f"vat_period_missing:{day.isoformat()}")
    return Decimal(str(row["percent"]))


def split(net, percent) -> dict:
    """The price before VAT, the rate, the VAT and the total, in agorot."""
    net = Decimal(str(net)).quantize(_AGORA, ROUND_HALF_UP)
    percent = Decimal(str(percent))
    vat = (net * percent / 100).quantize(_AGORA, ROUND_HALF_UP)
    return {"net": net, "percent": percent, "vat": vat, "total": net + vat}


def for_price(net, cur=None) -> dict:
    return split(net, percent_on(cur=cur))


def event_fields(money: dict) -> dict:
    """The money columns of a payment_events row: amount_nis is the total
    charged, VAT inside it, and the split beside it."""
    return {
        "amount_nis":     float(money["total"]),
        "net_amount_nis": float(money["net"]),
        "vat_percent":    float(money["percent"]),
        "vat_amount_nis": float(money["vat"]),
    }
