"""R37 4.1.5 · an admin refund: admin only, once, and always on record.

The database steps are replaced by recorders; the SQL runs against
MySQL in the R37 report.

Run: python -m unittest app.services.test_marketplace_refunds
"""
import asyncio
import unittest
from decimal import Decimal
from unittest import mock

from fastapi import HTTPException

from app.routes import marketplace_charges as routes
from app.services import marketplace_refunds as rf
from app.services.cardcom import CardcomApiError, CardcomNetworkError

ADMIN = "admin-user-1"


def a_charge(**over):
    row = dict(id="charge-1", kind="purchase", entity_type="service_provider", entity_id="prov-1",
               subscription_id="plan-1", amount_nis=Decimal("200.00"), status="charged", is_fake=0,
               provider_transaction_id="9911")
    row.update(over)
    return row


class Base(unittest.TestCase):
    def setUp(self):
        self.use()

    def use(self, result=None, fake_mode=False, claim=True):
        self.events, self.released, self.marked = [], [], []
        result = result if result is not None else {"refunded": True, "refund_transaction_id": "9912", "raw": {"NewTranzactionId": 9912}}

        async def refund(txn):
            self.asked = txn
            if isinstance(result, Exception):
                raise result
            return result

        def record(**kw):
            self.events.append(kw)
            return True, f"event-{len(self.events)}"

        self.cardcom = mock.AsyncMock(side_effect=refund)
        for target, value in (
            ("refund_transaction", self.cardcom), ("record_event", record),
            ("_claim", lambda cid: claim), ("_release", lambda cid: self.released.append(cid)),
            ("_mark_refunded", lambda cid, admin, event_id, txn: self.marked.append((cid, admin, event_id, txn))),
            ("_one", lambda cid: {"id": cid, "status": "refunded"}),
        ):
            p = mock.patch.object(rf, target, value)
            p.start()
            self.addCleanup(p.stop)
        p = mock.patch.object(rf.cardcom, "PAYMENT_FAKE_MODE", fake_mode)
        p.start()
        self.addCleanup(p.stop)

    def refund(self, charge=None):
        return asyncio.run(rf.refund(charge or a_charge(), ADMIN))

    def refused(self, charge=None):
        with self.assertRaises(rf.RefundRefused) as ctx:
            self.refund(charge)
        return ctx.exception


class RefundTest(Base):
    def test_the_charges_own_cardcom_transaction_is_what_is_refunded(self):
        out = self.refund()
        self.assertEqual(self.asked, "9911")
        self.assertEqual(out["status"], "refunded")

    def test_the_charge_row_records_when_who_and_cardcoms_refund_id(self):
        self.refund()
        self.assertEqual(self.marked, [("charge-1", ADMIN, "event-1", "9912")])

    def test_the_audit_row_names_the_charge_the_plan_the_transaction_and_the_admin(self):
        self.refund()
        (event,) = self.events
        self.assertEqual((event["kind"], event["outcome"], event["amount_nis"], event["provider_transaction_id"]),
                         ("marketplace_refund", "ok", 200, "9912"))
        self.assertEqual((event["entity_type"], event["entity_id"]), ("service_provider", "prov-1"))
        for key, value in (("charge_id", "charge-1"), ("subscription_id", "plan-1"),
                           ("refund_of", "9911"), ("admin_user_id", ADMIN)):
            self.assertEqual(event["raw"][key], value)

    def test_a_charge_already_refunded_is_not_refunded_again(self):
        refused = self.refused(a_charge(status="refunded"))
        self.assertEqual((refused.status, refused.detail["code"]), (409, "already_refunded"))
        self.cardcom.assert_not_awaited()
        self.assertEqual((self.events, self.marked), ([], []))

    def test_only_a_charge_that_was_taken_can_be_returned(self):
        for status in ("pending", "charging", "declined", "error", "not_attempted"):
            refused = self.refused(a_charge(status=status))
            self.assertEqual((refused.status, refused.detail["code"]), (409, "not_refundable"), status)
        self.cardcom.assert_not_awaited()

    def test_two_clicks_make_one_refund(self):
        self.use(claim=False)                       # the other click took the row first
        refused = self.refused()
        self.assertEqual((refused.status, refused.detail["code"]), (409, "refund_in_progress"))
        self.cardcom.assert_not_awaited()

    def test_a_refund_cardcom_refuses_is_recorded_and_the_charge_stays_a_charge(self):
        self.use(CardcomApiError("Refund error", code="5210", description="אין הרשאת זיכוי למסוף"))
        refused = self.refused()
        self.assertEqual((refused.status, refused.detail["code"]), (502, "refund_refused"))
        self.assertEqual(refused.detail["message"], "חברת הסליקה לא אישרה את הזיכוי: אין הרשאת זיכוי למסוף. החיוב לא זוכה.")
        self.assertEqual(self.released, ["charge-1"])
        self.assertEqual(self.marked, [])
        self.assertEqual([(e["outcome"], e["response_code"]) for e in self.events], [("declined", "5210")])

    def test_when_cardcom_does_not_answer_nothing_is_marked_and_the_admin_is_told_to_look(self):
        self.use(CardcomNetworkError("Timeout on refund"))
        refused = self.refused()
        self.assertEqual((refused.status, refused.detail["code"]), (502, "payment_provider_unreachable"))
        self.assertIn("Cardcom", refused.detail["message"])
        self.assertEqual((self.released, self.marked), (["charge-1"], []))
        self.assertEqual([e["outcome"] for e in self.events], ["error"])

    def test_a_test_mode_charge_is_not_sent_to_the_real_cardcom_and_the_reverse(self):
        for charge_fake, service_fake in ((1, False), (0, True)):
            self.use(fake_mode=service_fake)
            refused = self.refused(a_charge(is_fake=charge_fake))
            self.assertEqual((refused.status, refused.detail["code"]), (409, "payment_mode_mismatch"))
            self.cardcom.assert_not_awaited()

    def test_a_test_mode_charge_is_refunded_in_test_mode(self):
        self.use({"refunded": True, "refund_transaction_id": "FAKE-REFUND-1", "raw": {"fake": True}}, fake_mode=True)
        self.refund(a_charge(is_fake=1, provider_transaction_id="FAKE-abc"))
        self.assertEqual(self.marked[0][3], "FAKE-REFUND-1")

    def test_nothing_in_a_refund_touches_the_plan(self):
        import inspect
        source = inspect.getsource(rf)
        self.assertNotIn("marketplace_subscriptions", source.split('"""', 2)[2])
        self.assertNotIn("marketplace_listings", source)


class RouteTest(Base):
    def call(self, **headers):
        args = dict(x_user_id=ADMIN, x_user_role="corporation", x_user_is_admin="1")
        args.update(headers)
        with mock.patch.object(routes.marketplace_charges, "load", lambda cid: a_charge() if cid == "charge-1" else None):
            return asyncio.run(routes.refund_charge(args.pop("charge_id", "charge-1"), **args))

    def test_an_admin_acting_as_an_entity_is_still_an_admin(self):
        self.assertEqual(self.call()["status"], "refunded")

    def test_the_admin_who_asked_is_the_one_on_record(self):
        self.call()
        self.assertEqual(self.marked[0][1], ADMIN)

    def test_a_provider_cannot_refund_not_even_its_own_charge(self):
        for role, flag in (("service_provider", None), ("contractor", None), (None, None), ("service_provider", "0")):
            with self.assertRaises(HTTPException) as ctx:
                self.call(x_user_role=role, x_user_is_admin=flag)
            self.assertEqual((ctx.exception.status_code, ctx.exception.detail), (403, "admin_only"))
        self.cardcom.assert_not_awaited()

    def test_a_charge_that_does_not_exist_is_404(self):
        with self.assertRaises(HTTPException) as ctx:
            self.call(charge_id="nope")
        self.assertEqual(ctx.exception.status_code, 404)

    def test_a_refusal_keeps_its_status_and_its_hebrew(self):
        self.use(CardcomApiError("x", code="1", description="נדחה"))
        with self.assertRaises(HTTPException) as ctx:
            self.call()
        self.assertEqual((ctx.exception.status_code, ctx.exception.detail["code"]), (502, "refund_refused"))

    def test_the_list_of_all_charges_is_for_admins_only(self):
        with mock.patch.object(routes.marketplace_refunds, "list_for_admin", lambda: [{"id": "charge-1"}]):
            self.assertEqual(routes.all_charges(x_user_role="admin", x_user_is_admin=None), [{"id": "charge-1"}])
            for role in ("service_provider", "contractor", "corporation", None):
                with self.assertRaises(HTTPException) as ctx:
                    routes.all_charges(x_user_role=role, x_user_is_admin=None)
                self.assertEqual(ctx.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
