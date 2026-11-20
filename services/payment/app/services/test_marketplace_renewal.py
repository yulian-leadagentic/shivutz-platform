"""R37 4.1.4 · a paid plan renews by the subscriptions' own failure rule.

The decisions are tested here with the database steps replaced by
recorders; the SQL itself is run against MySQL in the R37 report.

  * charged: another period, at the tier row's price of the day
  * declined: past_due and another attempt later; the last failed
    attempt ends the plan and pauses its listings
  * Cardcom unreachable: nothing moves
  * no card: the same chain, never a free period
  * the numbers are the ones routes/subscriptions.py uses

Run: python -m unittest app.services.test_marketplace_renewal
"""
import asyncio
import os
import unittest
from datetime import datetime
from decimal import Decimal
from unittest import mock

from app.routes import subscriptions
from app.services import marketplace_renewal as mr
from app.services.cardcom import CardcomDeclinedError, CardcomNetworkError

NOW = datetime(2027, 2, 1, 9, 0, 0)
TIER = {"id": "tier-1", "category_code": "transport", "price_nis": Decimal("250.00"), "duration_days": 30,
        "tier_active": 1, "category_active": 1}
CARD = {"id": "card-1", "provider_token": "enc", "expiry_month": 7, "expiry_year": 2028}
OK = {"provider_transaction_id": "9911", "response_code": "0", "invoice_number": "3106",
      "invoice_url": "https://cardcom/doc/3106", "raw": {}}


def a_plan(**over):
    plan = dict(id="plan-1", advertiser_entity_type="service_provider", advertiser_entity_id="prov-1",
                category_code="transport", tier_id="tier-1", slot_count=5, duration_days=30,
                price_nis=Decimal("200.00"), auto_renew=1, status="active", rebill_attempts=0,
                payment_transaction_id="event-0")
    plan.update(over)
    return plan


class Base(unittest.TestCase):
    def run_pass(self, plan, charge_result=OK, card=CARD, tier=TIER, other_plan=False, free_launch=False):
        self.steps, self.events = [], []
        self.settled, self.failed, self.ended, self.renewed, self.noted = [], [], [], [], []

        def step(name, value=None):
            def do(*args, **kwargs):
                self.steps.append(name)
                return value
            return do

        async def charge(**kw):
            self.steps.append("cardcom")
            self.sent = kw
            if isinstance(charge_result, Exception):
                raise charge_result
            return charge_result

        def record(**kw):
            self.events.append(kw)
            return True, f"event-{len(self.events)}"

        def opened(p, t, money):
            self.steps.append("charge_row")
            self.opened_money = money
            return {"id": "charge-9", "kind": "renewal", "entity_type": p["advertiser_entity_type"],
                    "entity_id": p["advertiser_entity_id"], "tier_id": p["tier_id"],
                    "duration_days": int(t["duration_days"]), "amount_nis": money["total"],
                    "net_amount_nis": money["net"], "vat_percent": money["percent"],
                    "vat_amount_nis": money["vat"]}

        def fail(p, reason, interval_days, max_attempts):
            self.failed.append((reason, interval_days, max_attempts))
            return "expired" if int(p.get("rebill_attempts") or 0) + 1 >= max_attempts else "past_due"

        self.charge_token = mock.AsyncMock(side_effect=charge)
        patches = [
            mock.patch.object(mr, "_due", lambda now, limit: [plan]),
            mock.patch.object(mr, "_latch", step("latch")),
            mock.patch.object(mr, "_note", lambda pid, err: self.noted.append(err)),
            mock.patch.object(mr, "_other_running_plan", lambda p: other_plan),
            mock.patch.object(mr, "_live_tier", lambda tier_id: tier),
            mock.patch.object(mr, "_open_charge", opened),
            mock.patch.object(mr, "_end", lambda p, reason: self.ended.append(reason) or 0),
            mock.patch.object(mr, "_fail", fail),
            mock.patch.object(mr, "_renewed", lambda p, c, card_id, event_id, result: self.renewed.append((c, card_id, event_id))),
            mock.patch.object(mr, "charge_token", self.charge_token),
            mock.patch.object(mr, "record_event", record),
            mock.patch.object(mr, "decrypt_token", lambda t: "tok(" + t + ")"),
            mock.patch.object(mr.mc, "default_card", lambda etype, eid: card),
            mock.patch.object(mr.mc, "invoice_data", lambda c: {"description": "x"}),
            mock.patch.object(mr.mc, "_settle", lambda cid, status, reason=None, event_id=None: self.settled.append((cid, status, reason))),
            mock.patch.object(mr.cardcom, "_free_launch_active", lambda: free_launch),
            # The VAT period in force, as payment_db.vat_periods would give it.
            mock.patch.object(mr.vat, "percent_on", lambda day=None, cur=None: Decimal("18")),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        return asyncio.run(mr.renew_due_plans(NOW, interval_days=3, max_attempts=3, limit=100))


class RenewTest(Base):
    def test_a_charged_renewal_runs_another_period_at_todays_tier_price(self):
        counts = self.run_pass(a_plan())
        self.assertEqual(counts, {"processed": 1, "charged": 1, "failed": 0, "ended": 0, "skipped": 0})
        # Fixes ג item 6 · the tier price is before VAT: 250 + 18% = 295.
        self.assertEqual((self.sent["base_amount"], self.sent["vat_amount"]), (250.0, 45.0))
        (charge, card_id, event_id), = self.renewed
        self.assertEqual((charge["amount_nis"], charge["net_amount_nis"], charge["vat_amount_nis"],
                          charge["duration_days"], card_id, event_id),
                         (Decimal("295.00"), Decimal("250.00"), Decimal("45.00"), 30, "card-1", "event-1"))

    def test_the_attempt_is_stamped_before_cardcom_is_called(self):
        self.run_pass(a_plan())
        self.assertEqual(self.steps, ["latch", "charge_row", "cardcom"])

    def test_the_charge_rows_id_is_what_cardcom_gets_against_a_double_charge(self):
        self.run_pass(a_plan())
        self.assertEqual((self.sent["idempotency_key"], self.sent["card_expiry"]), ("charge-9", "0728"))

    def test_the_audit_row_is_a_renewal_of_that_plan(self):
        self.run_pass(a_plan())
        (event,) = self.events
        self.assertEqual((event["kind"], event["outcome"], event["amount_nis"]), ("marketplace_renewal", "ok", 295.0))
        self.assertEqual((event["net_amount_nis"], event["vat_percent"], event["vat_amount_nis"]), (250.0, 18.0, 45.0))
        self.assertEqual((event["raw"]["subscription_id"], event["raw"]["charge_id"]), ("plan-1", "charge-9"))

    def test_a_declined_card_is_past_due_with_the_batchs_own_numbers(self):
        counts = self.run_pass(a_plan(), CardcomDeclinedError("no", code="6003", description="כרטיס חסום"))
        self.assertEqual((counts["failed"], counts["charged"], counts["ended"]), (1, 0, 0))
        self.assertEqual(self.failed, [("כרטיס חסום", 3, 3)])
        self.assertEqual(self.settled, [("charge-9", "declined", "כרטיס חסום")])
        self.assertEqual(self.renewed, [])
        self.assertEqual([e["outcome"] for e in self.events], ["declined"])

    def test_the_last_failed_attempt_ends_the_plan(self):
        counts = self.run_pass(a_plan(status="past_due", rebill_attempts=2), CardcomDeclinedError("no", code="1"))
        self.assertEqual((counts["ended"], counts["failed"]), (1, 0))

    def test_cardcom_unreachable_moves_nothing(self):
        counts = self.run_pass(a_plan(), CardcomNetworkError("timeout"))
        self.assertEqual((counts["skipped"], counts["failed"], counts["ended"]), (1, 0, 0))
        self.assertEqual((self.failed, self.ended, self.renewed), ([], [], []))
        self.assertEqual(self.settled[0][1], "error")

    def test_no_card_is_a_failed_renewal_never_a_free_period(self):
        counts = self.run_pass(a_plan(), card=None)
        self.assertEqual((counts["failed"], counts["charged"]), (1, 0))
        self.charge_token.assert_not_awaited()
        self.assertEqual(self.failed, [("no_payment_method", 3, 3)])
        self.assertEqual(self.renewed, [])
        self.assertEqual([e["outcome"] for e in self.events], ["no_payment_method"])

    def test_renewal_turned_off_during_the_chain_ends_the_plan_without_a_charge(self):
        counts = self.run_pass(a_plan(status="past_due", auto_renew=0, rebill_attempts=1))
        self.assertEqual(counts["ended"], 1)
        self.assertEqual(self.ended, ["renewal_turned_off"])
        self.charge_token.assert_not_awaited()

    def test_a_plan_replaced_by_another_in_its_category_is_not_charged(self):
        counts = self.run_pass(a_plan(status="past_due", rebill_attempts=1), other_plan=True)
        self.assertEqual((counts["ended"], self.ended), (1, ["replaced_by_another_plan"]))
        self.charge_token.assert_not_awaited()

    def test_a_tier_that_is_no_longer_sold_is_left_for_a_person(self):
        counts = self.run_pass(a_plan(), tier=None)
        self.assertEqual((counts["skipped"], self.noted), (1, ["tier_unavailable"]))
        self.charge_token.assert_not_awaited()
        self.assertEqual((self.failed, self.ended), ([], []))

    def test_the_free_launch_switch_renews_nothing(self):
        counts = self.run_pass(a_plan(), free_launch=True)
        self.assertEqual((counts["skipped"], self.noted), (1, ["free_launch_env_active"]))
        self.charge_token.assert_not_awaited()
        self.assertEqual(self.renewed, [])


class ChainTest(unittest.TestCase):
    def _fail(self, attempts_so_far):
        ran, ended = [], []
        with mock.patch.object(mr, "_run", lambda sql, params: ran.append((" ".join(sql.split()), params)) or 1), \
             mock.patch.object(mr, "_end", lambda plan, reason: ended.append(reason) or 0):
            out = mr._fail(a_plan(rebill_attempts=attempts_so_far), "declined", 3, 3)
        return out, ran, ended

    def test_the_first_and_second_failures_schedule_another_attempt(self):
        for so_far in (0, 1):
            out, ran, ended = self._fail(so_far)
            self.assertEqual((out, ended), ("past_due", []))
            sql, params = ran[0]
            self.assertIn("status='past_due'", sql)
            self.assertIn("next_attempt_at=DATE_ADD(NOW(), INTERVAL %s DAY)", sql)
            self.assertEqual(params[:2], (so_far + 1, 3))

    def test_the_third_failure_ends_the_plan(self):
        out, ran, ended = self._fail(2)
        self.assertEqual((out, ran, ended), ("expired", [], ["declined"]))


class BatchTest(unittest.TestCase):
    def test_the_daily_batch_renews_plans_with_its_own_rule_numbers(self):
        conn = mock.MagicMock()
        conn.cursor.return_value.fetchall.return_value = []      # no subscriptions due
        plans = mock.AsyncMock(return_value={"processed": 0})
        with mock.patch.object(subscriptions, "get_db", return_value=conn), \
             mock.patch.object(subscriptions.marketplace_renewal, "renew_due_plans", plans), \
             mock.patch.dict(os.environ, {"INTERNAL_BATCH_SECRET": "s3cret"}):
            out = asyncio.run(subscriptions.renewal_batch(x_internal_secret="s3cret"))
        self.assertEqual(out["marketplace_plans"], {"processed": 0})
        kwargs = plans.await_args.kwargs
        self.assertEqual((kwargs["interval_days"], kwargs["max_attempts"], kwargs["limit"]),
                         (subscriptions.REBILL_INTERVAL_DAYS, subscriptions.REBILL_MAX_ATTEMPTS,
                          subscriptions.RENEWAL_BATCH_LIMIT))

    def test_without_the_secret_the_batch_renews_nothing(self):
        from fastapi import HTTPException
        plans = mock.AsyncMock()
        with mock.patch.object(subscriptions.marketplace_renewal, "renew_due_plans", plans), \
             mock.patch.dict(os.environ, {"INTERNAL_BATCH_SECRET": "s3cret"}):
            with self.assertRaises(HTTPException) as ctx:
                asyncio.run(subscriptions.renewal_batch(x_internal_secret="wrong"))
        self.assertEqual(ctx.exception.status_code, 401)
        plans.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()


class PayNowTest(unittest.TestCase):
    """Fixes, 20.11 · the owner pays a past_due plan now."""

    def pay(self, plan, charge_result=OK, card=CARD, tier=TIER, other_plan=False, free_launch=False):
        self.steps, self.events, self.settled, self.renewed, self.failed = [], [], [], [], []

        async def charge(**kw):
            self.steps.append("cardcom")
            self.sent = kw
            if isinstance(charge_result, Exception):
                raise charge_result
            return charge_result

        def record(**kw):
            self.events.append(kw)
            return True, f"event-{len(self.events)}"

        def opened(p, t, money):
            self.steps.append("charge_row")
            return {"id": "charge-9", "kind": "renewal", "duration_days": int(t["duration_days"]),
                    "amount_nis": money["total"], "net_amount_nis": money["net"]}

        patches = [
            mock.patch.object(mr, "_one", lambda sql, params: plan),
            mock.patch.object(mr, "_latch", lambda pid, when: self.steps.append("latch")),
            mock.patch.object(mr, "_other_running_plan", lambda p: other_plan),
            mock.patch.object(mr, "_live_tier", lambda tier_id: tier),
            mock.patch.object(mr, "_open_charge", opened),
            mock.patch.object(mr, "_fail", lambda *a: self.failed.append(a)),
            mock.patch.object(mr, "_renewed", lambda p, c, card_id, event_id, result: self.renewed.append((c, card_id, event_id))),
            mock.patch.object(mr, "charge_token", mock.AsyncMock(side_effect=charge)),
            mock.patch.object(mr, "record_event", record),
            mock.patch.object(mr, "decrypt_token", lambda t: "tok(" + t + ")"),
            mock.patch.object(mr.mc, "default_card", lambda etype, eid: card),
            mock.patch.object(mr.mc, "invoice_data", lambda c: {"description": "x"}),
            mock.patch.object(mr.mc, "_settle", lambda cid, status, reason=None, event_id=None: self.settled.append((cid, status))),
            mock.patch.object(mr.cardcom, "_free_launch_active", lambda: free_launch),
            mock.patch.object(mr.vat, "percent_on", lambda day=None, cur=None: Decimal("18")),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        return asyncio.run(mr.pay_now("plan-1", "service_provider", "prov-1", NOW))

    def refused(self, **kw):
        with self.assertRaises(mr.mc.ChargeRefused) as ctx:
            self.pay(**kw)
        return ctx.exception

    def test_a_past_due_plan_is_charged_now_and_runs_another_period(self):
        out = self.pay(a_plan(status="past_due", rebill_attempts=1))
        self.assertEqual((self.sent["base_amount"], self.sent["vat_amount"]), (250.0, 45.0))
        self.assertEqual(self.steps, ["latch", "charge_row", "cardcom"])
        self.assertEqual(len(self.renewed), 1)
        self.assertEqual((out["status"], out["amount_nis"], out["invoice_number"]), ("charged", Decimal("295.00"), "3106"))

    def test_only_a_past_due_paid_plan_can_be_paid_now(self):
        for plan in (None, a_plan(status="active"), a_plan(status="past_due", payment_transaction_id=None)):
            with self.subTest(plan=plan and plan["status"]):
                err = self.refused(plan=plan)
                self.assertEqual((err.status, err.detail["code"]), (409, "plan_not_past_due"))
                self.assertNotIn("cardcom", self.steps)

    def test_a_second_press_right_after_an_attempt_is_refused(self):
        err = self.refused(plan=a_plan(status="past_due", last_renewal_attempt_at=datetime(2027, 2, 1, 8, 59, 30)))
        self.assertEqual(err.detail["code"], "payment_in_progress")
        self.assertNotIn("cardcom", self.steps)

    def test_an_attempt_a_while_ago_does_not_block_paying(self):
        self.pay(a_plan(status="past_due", last_renewal_attempt_at=datetime(2027, 2, 1, 8, 0, 0)))
        self.assertEqual(len(self.renewed), 1)

    def test_no_card_is_refused_before_anything_is_written(self):
        err = self.refused(plan=a_plan(status="past_due"), card=None)
        self.assertEqual((err.status, err.detail["code"]), (402, "no_payment_method"))
        self.assertEqual(self.steps, [])

    def test_a_declined_card_says_so_and_does_not_move_the_attempt_chain(self):
        err = self.refused(plan=a_plan(status="past_due", rebill_attempts=2),
                           charge_result=CardcomDeclinedError("declined", code="5", description="כרטיס חסום"))
        self.assertEqual((err.status, err.detail["code"]), (402, "card_declined"))
        self.assertIn("כרטיס חסום", err.detail["message"])
        self.assertEqual(self.failed, [])
        self.assertEqual(self.settled, [("charge-9", "declined")])
        self.assertEqual(self.renewed, [])

    def test_cardcom_unreachable_is_reported_and_nothing_renews(self):
        err = self.refused(plan=a_plan(status="past_due"), charge_result=CardcomNetworkError("timeout"))
        self.assertEqual((err.status, err.detail["code"]), (502, "payment_provider_unreachable"))
        self.assertEqual((self.renewed, self.failed), ([], []))

    def test_another_running_plan_in_the_category_is_not_renewed(self):
        err = self.refused(plan=a_plan(status="past_due"), other_plan=True)
        self.assertEqual(err.detail["code"], "already_subscribed_to_category")
        self.assertNotIn("cardcom", self.steps)

    def test_the_free_launch_switch_charges_nothing(self):
        err = self.refused(plan=a_plan(status="past_due"), free_launch=True)
        self.assertEqual(err.detail["code"], "payment_not_live")
        self.assertNotIn("cardcom", self.steps)
