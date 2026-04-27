"""VAT lookup against the multi-period vat_periods table.

A `vat_periods` row defines a half-open-ish interval [valid_from, valid_until]
(both inclusive). NULL valid_until means "still in effect".

Resolution rule for charge_date X:
  - all rows where valid_from <= X AND (valid_until IS NULL OR valid_until >= X)
  - on multiple matches (overlap), the one with the latest valid_from wins
  - on no matches (gap), raises VATPeriodMissing — admin must fix
"""
from datetime import date
from decimal import Decimal
from typing import Optional

from app.db import get_db


class VATPeriodMissing(Exception):
    """No vat_periods row covers the requested charge_date."""


def get_vat_for_date(charge_date: Optional[date] = None) -> Decimal:
    """Returns the VAT as a fraction (e.g. 0.18 for 18%).

    `charge_date` defaults to today. Note the table stores `percent` as a
    number (18.00), not a fraction — we divide here so callers can keep
    using the rate as a multiplier.
    """
    if charge_date is None:
        charge_date = date.today()
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT percent
               FROM vat_periods
               WHERE valid_from <= %s
                 AND (valid_until IS NULL OR valid_until >= %s)
               ORDER BY valid_from DESC
               LIMIT 1""",
            (charge_date, charge_date),
        )
        row = cur.fetchone()
        if not row:
            raise VATPeriodMissing(
                f"No VAT period covers {charge_date}. Admin must add one in /admin/commissions."
            )
        return (Decimal(str(row["percent"])) / Decimal(100)).quantize(Decimal("0.0001"))
    finally:
        conn.close()


def list_periods() -> list:
    """Return every period, newest first — for the admin UI."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT id, percent, valid_from, valid_until, notes,
                      created_at, created_by_user_id
               FROM vat_periods
               ORDER BY valid_from DESC"""
        )
        rows = cur.fetchall()
        for r in rows:
            r["percent"] = float(r["percent"])
            for f in ("valid_from", "valid_until", "created_at"):
                if r.get(f) is not None and hasattr(r[f], "isoformat"):
                    r[f] = r[f].isoformat()
        return rows
    finally:
        conn.close()
