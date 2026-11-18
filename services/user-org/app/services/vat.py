"""VAT on top of a price (fixes list ג, item 6; Yulian, 18.11).

The same lookup as payment/app/services/vat.py: the rate in force today,
Israel time, from payment_db.vat_periods, VAT rounded to the agora half
up. user-org needs it for the provider plan quote and for the purchase
row it writes before the payment service charges it.
"""
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional
from zoneinfo import ZoneInfo

_IL = ZoneInfo("Asia/Jerusalem")
_AGORA = Decimal("0.01")


class VatPeriodMissing(RuntimeError):
    """No VAT period covers the day. Nothing may be charged."""


def percent_on(cur, day: Optional[date] = None) -> Decimal:
    day = day or datetime.now(_IL).date()
    cur.execute(
        "SELECT percent FROM payment_db.vat_periods "
        "WHERE valid_from <= %s AND (valid_until IS NULL OR valid_until >= %s) "
        "ORDER BY valid_from DESC LIMIT 1",
        (day, day),
    )
    row = cur.fetchone()
    if not row or row.get("percent") is None:
        raise VatPeriodMissing(f"vat_period_missing:{day.isoformat()}")
    return Decimal(str(row["percent"]))


def split(net, percent) -> dict:
    net = Decimal(str(net)).quantize(_AGORA, ROUND_HALF_UP)
    percent = Decimal(str(percent))
    vat = (net * percent / 100).quantize(_AGORA, ROUND_HALF_UP)
    return {"net": net, "percent": percent, "vat": vat, "total": net + vat}


def for_price(cur, net) -> dict:
    return split(net, percent_on(cur))


def as_json(money: dict) -> dict:
    return {"net_nis": float(money["net"]), "vat_percent": float(money["percent"]),
            "vat_nis": float(money["vat"]), "total_nis": float(money["total"])}
