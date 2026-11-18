"""Fixes list ג, item 6 · the provider quote and purchase row add VAT the
same way the payment service does.

Run: python -m unittest app.services.test_vat
"""
import unittest
from datetime import date
from decimal import Decimal

from app.services import vat


class _Cur:
    def __init__(self, row):
        self.row, self.params = row, None

    def execute(self, sql, params=None):
        self.sql, self.params = sql, params

    def fetchone(self):
        return self.row


class VatTest(unittest.TestCase):
    def test_a_200_tier_is_236_with_18_percent(self):
        m = vat.for_price(_Cur({"percent": Decimal("18.00")}), 200)
        self.assertEqual((m["net"], m["vat"], m["total"]), (Decimal("200.00"), Decimal("36.00"), Decimal("236.00")))
        self.assertEqual(vat.as_json(m), {"net_nis": 200.0, "vat_percent": 18.0, "vat_nis": 36.0, "total_nis": 236.0})

    def test_the_rate_is_read_from_payment_db_for_the_day(self):
        cur = _Cur({"percent": Decimal("18.00")})
        vat.percent_on(cur, date(2026, 11, 18))
        self.assertIn("payment_db.vat_periods", cur.sql)
        self.assertEqual(cur.params, (date(2026, 11, 18), date(2026, 11, 18)))

    def test_no_period_no_price(self):
        with self.assertRaises(vat.VatPeriodMissing):
            vat.for_price(_Cur(None), 200)

    def test_rounding_matches_the_payment_service(self):
        self.assertEqual(vat.split("99.99", 18)["total"], Decimal("117.99"))


if __name__ == "__main__":
    unittest.main()
