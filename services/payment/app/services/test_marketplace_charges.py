"""R37 4.1.2 · a marketplace plan is activated only by a successful charge.

The database is an in-memory stand-in for the statements
marketplace_charges.py runs; Cardcom is a mock. What is pinned:

  * the amount charged is the one on the charge row
  * the plan row is written after Cardcom confirmed, never before
  * a declined card, an unreachable Cardcom, a missing card: no plan
  * asking twice charges once

Run: python -m unittest app.services.test_marketplace_charges
"""
import asyncio
import unittest
from decimal import Decimal
from unittest import mock

from fastapi import HTTPException

from app.routes import marketplace_charges as routes
from app.services import marketplace_charges as mc
from app.services.cardcom import CardcomDeclinedError, CardcomNetworkError

ME, OTHER = "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"


def a_charge(**over):
    row = dict(id="charge-1", kind="purchase", entity_type="service_provider", entity_id=ME,
               subscription_id=None, tier_id="tier-1", category_code="transport", slot_count=5,
               duration_days=30, amount_nis=Decimal("200.00"), auto_renew=1, status="pending",
               is_fake=0, payment_method_id=None, payment_event_id=None, provider_transaction_id=None,
               invoice_number=None, invoice_url=None, failure_reason=None)
    row.update(over)
    return row


CARD = dict(id="card-1", entity_type="service_provider", entity_id=ME, provider_token="enc",
            expiry_month=7, expiry_year=2028, status="active")


class FakeDB:
    def __init__(self, charge, card=CARD, provider=None):
        self.charges = {charge["id"]: dict(charge)}
        self.card = dict(card) if card else None
        self.provider = provider or {"name": "הסעות הצפון", "email": "office@north.test", "business_number": "514000000"}
        self.plans, self.log = [], []
        self.fail_plan_insert = False

    def connection(self, *_):
        return _Conn(self)


class _Conn:
    def __init__(self, db):
        self.db, self.pending = db, []

    def cursor(self):
        return _Cursor(self)

    def commit(self):
        for apply in self.pending:
            apply()
        self.pending = []

    def rollback(self):
        self.pending = []

    def close(self):
        pass


class _Cursor:
    def __init__(self, conn):
        self.conn, self.db, self.rows, self.rowcount = conn, conn.db, [], 0

    def execute(self, sql, params=()):
        sql, db = " ".join(sql.split()), self.db
        if sql.startswith("SELECT * FROM payment_db.marketplace_charges WHERE id=%s"):
            row = db.charges.get(params[0])
            self.rows = [dict(row)] if row else []
        elif "SET status='charging'" in sql:
            row = db.charges[params[1]]
            self.rowcount = 1 if row["status"] == "pending" else 0
            if self.rowcount:
                row.update(status="charging", is_fake=params[0])      # the claim is immediate, as a commit follows it
        elif "SET status=%s, failure_reason=%s" in sql:
            status, reason, event_id, cid = params
            row = db.charges[cid]
            if row["status"] == "charging":
                row.update(status=status, failure_reason=reason, payment_event_id=event_id or row["payment_event_id"])
        elif sql.startswith("SELECT * FROM payment_db.payment_methods"):
            card = db.card
            self.rows = [dict(card)] if card and (card["entity_type"], card["entity_id"]) == tuple(params) else []
        elif "FROM org_db.marketplace_subscription_tiers t" in sql:
            self.rows = [{"tier_name": "בסיסי", "category_name": "הסעות"}]
        elif "FROM org_db.service_providers" in sql:
            self.rows = [dict(db.provider)]
        elif sql.startswith("INSERT INTO org_db.marketplace_subscriptions"):
            if db.fail_plan_insert:
                raise RuntimeError("plan insert failed")
            db.log.append("plan_insert")
            keys = ("id", "advertiser_entity_type", "advertiser_entity_id", "category_code", "tier_id",
                    "slot_count", "duration_days", "price_nis", "days_from_now", "auto_renew",
                    "cardcom_token_ref", "payment_transaction_id")
            plan = dict(zip(keys, params), status="active")
            self.conn.pending.append(lambda: db.plans.append(plan))
        elif "SET status='charged'" in sql:
            sub_id, card_id, event_id, txn, inv_no, inv_url, cid = params
            row = db.charges[cid]
            self.rowcount = 1 if row["status"] == "charging" else 0
            self.conn.pending.append(lambda: row.update(
                status="charged", subscription_id=sub_id, payment_method_id=card_id, payment_event_id=event_id,
                provider_transaction_id=txn, invoice_number=inv_no, invoice_url=inv_url, failure_reason=None))
        elif sql.startswith("UPDATE payment_db.payment_methods SET last_used_at"):
            pass
        else:
            raise AssertionError("unexpected SQL: " + sql)

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return list(self.rows)


OK = {"provider_transaction_id": "9911", "response_code": "0", "invoice_number": "3105",
      "invoice_url": "https://cardcom/doc/3105", "raw": {"TranzactionId": 9911}}


class Base(unittest.TestCase):
    def setUp(self):
        self.use(FakeDB(a_charge()))

    def use(self, db, charge_result=OK, free_launch=False):
        self.db = db
        self.events = []

        def record(**kw):
            self.events.append(kw)
            db.log.append("event:" + kw["outcome"])
            return True, f"event-{len(self.events)}"

        async def charge(**kw):
            db.log.append("cardcom")
            self.sent = kw
            if isinstance(charge_result, Exception):
                raise charge_result
            return charge_result

        self.charge_token = mock.AsyncMock(side_effect=charge)
        for target, value in (
            ("get_db", db.connection), ("charge_token", self.charge_token), ("record_event", record),
            ("decrypt_token", lambda t: "tok(" + t + ")"),
        ):
            p = mock.patch.object(mc, target, value)
            p.start()
            self.addCleanup(p.stop)
        p = mock.patch.object(mc.cardcom, "_free_launch_active", lambda: free_launch)
        p.start()
        self.addCleanup(p.stop)

    def pay(self, charge_id="charge-1"):
        return asyncio.run(mc.pay(mc.load(charge_id)))

    def refused(self):
        with self.assertRaises(mc.ChargeRefused) as ctx:
            self.pay()
        return ctx.exception


class PaidTest(Base):
    def test_the_card_is_charged_the_amount_on_the_row_vat_inside_it(self):
        self.pay()
        self.assertEqual((self.sent["base_amount"], self.sent["vat_amount"]), (200.0, 0))
        self.assertEqual(self.sent["provider_token"], "tok(enc)")
        self.assertEqual(self.sent["card_expiry"], "0728")

    def test_the_rows_id_is_what_stops_cardcom_charging_it_twice(self):
        self.pay()
        self.assertEqual(self.sent["idempotency_key"], "charge-1")

    def test_the_plan_is_written_only_after_cardcom_confirmed(self):
        self.pay()
        self.assertEqual(self.db.log, ["cardcom", "event:ok", "plan_insert"])

    def test_the_plan_is_the_one_the_charge_describes(self):
        out = self.pay()
        (plan,) = self.db.plans
        self.assertEqual(
            (plan["advertiser_entity_type"], plan["advertiser_entity_id"], plan["category_code"], plan["tier_id"],
             plan["slot_count"], plan["duration_days"], plan["price_nis"], plan["days_from_now"], plan["auto_renew"]),
            ("service_provider", ME, "transport", "tier-1", 5, 30, Decimal("200.00"), 30, True))
        self.assertEqual(out["subscription_id"], plan["id"])
        self.assertEqual(out["status"], "charged")

    def test_the_plan_points_at_the_card_row_and_the_event_not_at_a_token(self):
        self.pay()
        plan = self.db.plans[0]
        self.assertEqual((plan["cardcom_token_ref"], plan["payment_transaction_id"]), ("card-1", "event-1"))

    def test_the_charge_row_keeps_the_transaction_and_the_invoice(self):
        out = self.pay()
        row = self.db.charges["charge-1"]
        self.assertEqual((row["status"], row["provider_transaction_id"], row["invoice_number"], row["payment_method_id"]),
                         ("charged", "9911", "3105", "card-1"))
        self.assertEqual((out["invoice_number"], out["invoice_url"]), ("3105", "https://cardcom/doc/3105"))

    def test_the_audit_row_says_what_was_charged_and_for_which_charge(self):
        self.pay()
        (event,) = self.events
        self.assertEqual((event["kind"], event["outcome"], event["amount_nis"], event["provider_transaction_id"]),
                         ("marketplace_purchase", "ok", 200, "9911"))
        self.assertEqual(event["raw"]["charge_id"], "charge-1")
        self.assertEqual((event["entity_type"], event["entity_id"]), ("service_provider", ME))

    def test_the_document_is_made_out_to_the_provider(self):
        self.pay()
        doc = self.sent["invoice_data"]
        self.assertEqual((doc["customer_name"], doc["customer_email"], doc["tax_id"]),
                         ("הסעות הצפון", "office@north.test", "514000000"))
        self.assertEqual(doc["description"], "מסלול פרסום בשירותים נלווים · הסעות · בסיסי · 30 ימים")

    def test_a_business_number_that_is_not_one_stays_off_the_document(self):
        for number in ("12345", "51400000a", None, ""):
            self.use(FakeDB(a_charge(), provider={"name": "ספק", "email": None, "business_number": number}))
            self.pay()
            self.assertEqual(self.sent["invoice_data"]["tax_id"], "")

    def test_paying_twice_charges_once(self):
        first = self.pay()
        again = self.pay()
        self.assertEqual(again, first)
        self.assertEqual(self.charge_token.await_count, 1)
        self.assertEqual(len(self.db.plans), 1)

    def test_a_row_another_request_already_took_is_left_alone(self):
        stale = mc.load("charge-1")                      # read while still pending
        self.db.charges["charge-1"]["status"] = "charging"   # then taken elsewhere
        out = asyncio.run(mc.pay(stale))
        self.assertEqual(out["status"], "charging")
        self.charge_token.assert_not_awaited()
        self.assertEqual(self.db.plans, [])


class NotPaidTest(Base):
    def test_a_declined_card_leaves_no_plan_and_says_why_in_hebrew(self):
        self.use(FakeDB(a_charge()), CardcomDeclinedError("Charge declined: כרטיס חסום", code="6003", description="כרטיס חסום"))
        refused = self.refused()
        self.assertEqual((refused.status, refused.detail["code"]), (402, "card_declined"))
        self.assertEqual(refused.detail["message"], "החיוב לא אושר: כרטיס חסום. המסלול לא הופעל.")
        self.assertEqual((refused.detail["reason"], refused.detail["response_code"]), ("כרטיס חסום", "6003"))
        self.assertEqual(self.db.plans, [])
        row = self.db.charges["charge-1"]
        self.assertEqual((row["status"], row["failure_reason"], row["subscription_id"]), ("declined", "כרטיס חסום", None))
        self.assertEqual([e["outcome"] for e in self.events], ["declined"])
        self.assertNotIn("plan_insert", self.db.log)

    def test_a_decline_with_no_text_from_cardcom_still_reads_in_hebrew(self):
        self.use(FakeDB(a_charge()), CardcomDeclinedError("Test decline (PAYMENT_FAKE_MODE=1)", code="TEST_DECLINE"))
        refused = self.refused()
        self.assertEqual(refused.detail["message"], "החיוב לא אושר על ידי חברת האשראי. המסלול לא הופעל.")
        self.assertIsNone(refused.detail["reason"])

    def test_cardcom_unreachable_leaves_no_plan(self):
        self.use(FakeDB(a_charge()), CardcomNetworkError("Timeout charging"))
        refused = self.refused()
        self.assertEqual((refused.status, refused.detail["code"]), (502, "payment_provider_unreachable"))
        self.assertEqual(self.db.plans, [])
        self.assertEqual(self.db.charges["charge-1"]["status"], "error")
        self.assertEqual([e["outcome"] for e in self.events], ["error"])

    def test_no_card_on_file_never_reaches_cardcom(self):
        self.use(FakeDB(a_charge(), card=None))
        refused = self.refused()
        self.assertEqual((refused.status, refused.detail["code"]), (402, "no_payment_method"))
        self.charge_token.assert_not_awaited()
        self.assertEqual(self.db.charges["charge-1"]["status"], "not_attempted")
        self.assertEqual(self.db.plans, [])

    def test_another_entitys_card_is_not_this_entitys_card(self):
        self.use(FakeDB(a_charge(), card={**CARD, "entity_id": OTHER}))
        self.assertEqual(self.refused().detail["code"], "no_payment_method")
        self.charge_token.assert_not_awaited()

    def test_the_free_launch_switch_does_not_hand_out_a_paid_plan(self):
        self.use(FakeDB(a_charge()), free_launch=True)
        refused = self.refused()
        self.assertEqual((refused.status, refused.detail["code"]), (503, "payment_not_live"))
        self.charge_token.assert_not_awaited()
        self.assertEqual(self.db.plans, [])
        self.assertEqual(self.db.charges["charge-1"]["failure_reason"], "free_launch_env_active")

    def test_a_refused_charge_cannot_be_paid_again(self):
        self.use(FakeDB(a_charge()), CardcomDeclinedError("no", code="1"))
        self.refused()
        out = self.pay()                      # the same row, asked again
        self.assertEqual(out["status"], "declined")
        self.assertEqual(self.charge_token.await_count, 1)

    def test_if_the_plan_cannot_be_written_the_charge_is_left_marked_for_a_person(self):
        db = FakeDB(a_charge())
        db.fail_plan_insert = True
        self.use(db)
        with self.assertRaises(RuntimeError):
            self.pay()
        self.assertEqual(self.db.charges["charge-1"]["status"], "charging")
        self.assertEqual([e["outcome"] for e in self.events], ["ok"])
        self.assertEqual(self.db.plans, [])


class RouteTest(Base):
    def call(self, entity_id=ME, entity_type="service_provider", charge_id="charge-1"):
        return asyncio.run(routes.pay_charge(charge_id, x_entity_id=entity_id, x_org_id=None, x_entity_type=entity_type))

    def test_the_owner_pays_its_own_charge(self):
        self.assertEqual(self.call()["status"], "charged")

    def test_someone_elses_charge_reads_as_not_found_and_charges_nobody(self):
        for entity_id, entity_type in ((OTHER, "service_provider"), (ME, "contractor")):
            with self.assertRaises(HTTPException) as ctx:
                self.call(entity_id, entity_type)
            self.assertEqual((ctx.exception.status_code, ctx.exception.detail), (404, "charge_not_found"))
        self.charge_token.assert_not_awaited()

    def test_a_charge_that_does_not_exist_is_404(self):
        with self.assertRaises(HTTPException) as ctx:
            self.call(charge_id="nope")
        self.assertEqual(ctx.exception.status_code, 404)

    def test_no_entity_no_charge(self):
        for entity_id, entity_type in ((None, "service_provider"), (ME, None), (ME, "admin")):
            with self.assertRaises(HTTPException) as ctx:
                self.call(entity_id, entity_type)
            self.assertEqual(ctx.exception.status_code, 403)

    def test_a_refusal_keeps_its_status_code_and_its_hebrew(self):
        self.use(FakeDB(a_charge(), card=None))
        with self.assertRaises(HTTPException) as ctx:
            self.call()
        self.assertEqual(ctx.exception.status_code, 402)
        self.assertEqual(ctx.exception.detail["code"], "no_payment_method")
        self.assertIn("המסלול לא הופעל", ctx.exception.detail["message"])

    def test_the_route_takes_nothing_but_the_charge_id(self):
        import inspect
        params = set(inspect.signature(routes.pay_charge).parameters)
        self.assertEqual(params, {"charge_id", "x_entity_id", "x_org_id", "x_entity_type"})


if __name__ == "__main__":
    unittest.main()
