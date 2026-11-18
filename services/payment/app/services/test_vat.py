"""Fixes list ג, item 6 · prices are before VAT; a charge is price plus VAT.

  * the rate comes from payment_db.vat_periods, never from code; with no
    period in force nothing is charged
  * VAT is rounded to the agora; the total is price plus VAT
  * a 200 plan goes to Cardcom as 236, one line carrying the total, on a
    tax invoice-receipt
  * a contractor plan start charges the price plus VAT and records the split

Run: python -m unittest app.services.test_vat
"""
import asyncio
import unittest
from datetime import date
from decimal import Decimal
from unittest import mock

from app.routes import subscriptions
from app.services import cardcom, vat
from app.services.test_cardcom_requests import CHARGED, _real


class _Cur:
    def __init__(self, row):
        self.row, self.sql = row, []

    def execute(self, sql, params=None):
        self.sql.append((sql, params))

    def fetchone(self):
        return self.row


class SplitTest(unittest.TestCase):
    def test_200_at_18_percent(self):
        self.assertEqual(vat.split(200, 18), {"net": Decimal("200.00"), "percent": Decimal("18"),
                                              "vat": Decimal("36.00"), "total": Decimal("236.00")})

    def test_vat_is_rounded_to_the_agora_half_up(self):
        m = vat.split("99.99", 18)        # 17.9982
        self.assertEqual((m["vat"], m["total"]), (Decimal("18.00"), Decimal("117.99")))
        m = vat.split("0.25", 18)         # 0.045
        self.assertEqual(m["vat"], Decimal("0.05"))

    def test_the_audit_fields_are_the_total_and_its_split(self):
        self.assertEqual(vat.event_fields(vat.split(150, 18)),
                         {"amount_nis": 177.0, "net_amount_nis": 150.0, "vat_percent": 18.0, "vat_amount_nis": 27.0})


class RateTest(unittest.TestCase):
    def test_the_rate_is_the_period_in_force_on_the_day(self):
        cur = _Cur({"percent": Decimal("18.00")})
        self.assertEqual(vat.percent_on(date(2026, 11, 18), cur=cur), Decimal("18.00"))
        sql, params = cur.sql[0]
        self.assertIn("payment_db.vat_periods", sql)
        self.assertEqual(params, (date(2026, 11, 18), date(2026, 11, 18)))

    def test_no_period_no_charge(self):
        with self.assertRaises(vat.VatPeriodMissing):
            vat.percent_on(date(2026, 11, 18), cur=_Cur(None))


class CardcomRequestTest(unittest.TestCase):
    def test_a_200_plan_goes_to_cardcom_as_236_on_a_tax_invoice_receipt(self):
        m = vat.split(200, 18)
        _, sent = _real(cardcom.charge_token, CHARGED, provider_token="tok", base_amount=float(m["net"]),
                        vat_amount=float(m["vat"]), deal_id="mp:1", idempotency_key="charge-1",
                        card_expiry="0728", invoice_data={"customer_name": "ספק", "description": "פרסום"})
        body = sent["json"]
        self.assertEqual(body["Amount"], 236.0)
        self.assertEqual(body["Document"]["Products"], [{"Description": "פרסום", "UnitCost": 236.0, "Quantity": 1}])
        self.assertEqual(body["Document"]["DocumentTypeToCreate"], "TaxInvoiceAndReceipt")


class _Conn:
    def cursor(self):
        return _Cur(None)

    def commit(self):
        pass

    def close(self):
        pass


class PlanStartTest(unittest.TestCase):
    def test_a_150_plan_is_charged_150_plus_vat_and_the_split_is_recorded(self):
        events = []
        charge = mock.AsyncMock(return_value={"provider_transaction_id": "t-1", "response_code": "0",
                                              "invoice_number": "1", "invoice_url": None, "raw": {}})
        row = {"id": "s-1", "status": "trialing", "tier": "basic", "extra_seats_paid": 0}
        patches = [
            mock.patch.object(subscriptions, "get_db", lambda name: _Conn()),
            mock.patch.object(subscriptions, "_fetch", lambda cur, eid, etype: row),
            mock.patch.object(subscriptions, "_default_payment_method",
                              lambda cur, eid, etype: {"provider_token": "enc", "id": "pm-1"}),
            mock.patch.object(subscriptions, "_plan_price", lambda cur, etype, tier: 150),
            mock.patch.object(subscriptions, "_invoice_data_for",
                              lambda cur, eid, etype, description: {"description": description}),
            mock.patch.object(subscriptions, "decrypt_token", lambda t: "tok"),
            mock.patch.object(subscriptions, "expiry_mmyy", lambda pm: "0728"),
            mock.patch.object(subscriptions, "charge_token", charge),
            mock.patch.object(subscriptions, "record_event", lambda **kw: events.append(kw) or (True, "e-1")),
            mock.patch.object(subscriptions, "_serialize", lambda r: dict(r)),
            mock.patch.object(subscriptions.vat, "percent_on", lambda day=None, cur=None: Decimal("18")),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        asyncio.run(subscriptions.start_subscription(
            subscriptions.StartBody(tier="basic"),
            x_entity_id="11111111-1111-4111-8111-111111111111", x_entity_type="contractor"))
        sent = charge.await_args.kwargs
        self.assertEqual((sent["base_amount"], sent["vat_amount"]), (150.0, 27.0))
        (event,) = events
        self.assertEqual((event["kind"], event["outcome"], event["amount_nis"], event["net_amount_nis"],
                          event["vat_percent"], event["vat_amount_nis"]),
                         ("subscription_start", "ok", 177.0, 150.0, 18.0, 27.0))

    def test_no_vat_period_means_no_charge(self):
        charge = mock.AsyncMock()
        def missing(day=None, cur=None):
            raise vat.VatPeriodMissing("vat_period_missing:2026-11-18")
        patches = [
            mock.patch.object(subscriptions, "get_db", lambda name: _Conn()),
            mock.patch.object(subscriptions, "_fetch", lambda cur, eid, etype: {"id": "s-1", "tier": "basic"}),
            mock.patch.object(subscriptions, "_default_payment_method", lambda cur, eid, etype: {"provider_token": "e"}),
            mock.patch.object(subscriptions, "_plan_price", lambda cur, etype, tier: 150),
            mock.patch.object(subscriptions, "charge_token", charge),
            mock.patch.object(subscriptions.vat, "percent_on", missing),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        with self.assertRaises(subscriptions.HTTPException) as ctx:
            asyncio.run(subscriptions.start_subscription(
                subscriptions.StartBody(tier="basic"),
                x_entity_id="11111111-1111-4111-8111-111111111111", x_entity_type="contractor"))
        self.assertEqual((ctx.exception.status_code, ctx.exception.detail), (500, {"code": "vat_period_missing"}))
        charge.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
