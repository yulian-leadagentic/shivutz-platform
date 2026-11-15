"""R37 4.1.1 / 4.1.6 · saving a card: whose it is, and when it is stored.

The database is a small in-memory stand-in that understands the handful
of statements card_setup.py runs; Cardcom is a mock. What is pinned:

  * the card is stored for the entity on OUR row, never for anyone a
    Cardcom answer names
  * nothing is stored unless Cardcom confirmed the page
  * a second completion (webhook after return page, a repeated webhook)
    changes nothing
  * the token is encrypted before it is written

Run: python -m unittest app.services.test_card_setup
"""
import asyncio
import os
import unittest
from unittest import mock

from app.services import card_setup
from app.services.cardcom import CardcomApiError, CardcomNetworkError, CardcomPendingError


class FakeDB:
    def __init__(self):
        self.setups, self.methods, self.commits = {}, [], 0

    def connection(self, *_):
        return _Conn(self)


class _Conn:
    def __init__(self, db):
        self.db = db

    def cursor(self):
        return _Cursor(self.db)

    def commit(self):
        self.db.commits += 1

    def rollback(self):
        pass

    def close(self):
        pass


class _Cursor:
    def __init__(self, db):
        self.db, self.row = db, None

    def execute(self, sql, params=()):
        sql = " ".join(sql.split())
        db = self.db
        if sql.startswith("INSERT INTO payment_card_setups"):
            sid, etype, eid, lp, fake, user = params
            db.setups[sid] = dict(id=sid, entity_type=etype, entity_id=eid, low_profile_id=lp, status="pending",
                                  is_fake=fake, payment_method_id=None, failure_reason=None, started_by_user_id=user)
        elif sql.startswith("SELECT * FROM payment_card_setups WHERE id=%s"):
            self.row = db.setups.get(params[0])
        elif sql.startswith("SELECT * FROM payment_card_setups WHERE low_profile_id=%s"):
            self.row = next((s for s in db.setups.values() if s["low_profile_id"] == params[0]), None)
        elif sql.startswith("UPDATE payment_card_setups SET status='failed'"):
            row = db.setups[params[1]]
            if row["status"] == "pending":
                row.update(status="failed", failure_reason=params[0])
        elif sql.startswith("UPDATE payment_card_setups SET status='completed'"):
            db.setups[params[1]].update(status="completed", payment_method_id=params[0])
        elif sql.startswith("UPDATE payment_methods SET is_default=FALSE, status='removed'"):
            for m in db.methods:
                if (m["entity_type"], m["entity_id"]) == tuple(params) and not m["deleted"]:
                    m.update(deleted=True, status="removed", is_default=False)
        elif sql.startswith("INSERT INTO payment_methods"):
            pm_id, etype, eid, token, last4, brand, holder, month, year = params
            db.methods.append(dict(id=pm_id, entity_type=etype, entity_id=eid, provider_token=token,
                                   last_4_digits=last4, card_brand=brand, card_holder_name=holder,
                                   expiry_month=month, expiry_year=year, is_default=True, status="active",
                                   deleted=False))
        else:
            raise AssertionError("unexpected SQL: " + sql)

    def fetchone(self):
        return dict(self.row) if self.row else None


PROVIDER = "11111111-1111-4111-8111-111111111111"
CARD = {"token": "tok-secret", "last_4_digits": "0042", "card_brand": "visa", "expiry_month": 7,
        "expiry_year": 2028, "card_holder_name": "דנה לוי", "raw": {}}


class Base(unittest.TestCase):
    fake_mode = False

    def setUp(self):
        self.db = FakeDB()
        self.result = mock.AsyncMock()
        self.page = mock.AsyncMock(return_value={"low_profile_id": "lp-1", "url": "https://cardcom/page"})
        for target, value in (
            ("get_db", self.db.connection),
            ("get_low_profile_result", self.result),
            ("create_low_profile", self.page),
            ("encrypt_token", lambda t: "enc(" + t + ")"),
            ("PAYMENT_FAKE_MODE", self.fake_mode),
        ):
            p = mock.patch.object(card_setup, target, value)
            p.start()
            self.addCleanup(p.stop)
        env = mock.patch.dict(os.environ, {"FRONTEND_URL": "https://site.test/",
                                           "PUBLIC_API_URL": "https://gw.test/api"})
        env.start()
        self.addCleanup(env.stop)

    def start(self, entity_type="service_provider", entity_id=PROVIDER):
        out = asyncio.run(card_setup.start(entity_type, entity_id, "user-1"))
        self.result.return_value = {**CARD, "return_value": out["setup_id"]}
        return out

    def complete(self, setup_id):
        return asyncio.run(card_setup.complete(card_setup.load(setup_id=setup_id)))


class StartTest(Base):
    def test_a_pending_row_says_whose_setup_it_is_before_the_browser_leaves(self):
        out = self.start()
        row = self.db.setups[out["setup_id"]]
        self.assertEqual((row["entity_type"], row["entity_id"], row["status"], row["low_profile_id"]),
                         ("service_provider", PROVIDER, "pending", "lp-1"))
        self.assertEqual(out["url"], "https://cardcom/page")
        self.assertEqual(out["mode"], "real")

    def test_cardcom_is_given_our_row_id_and_full_addresses(self):
        out = self.start()
        sent = self.page.await_args.kwargs
        sid = out["setup_id"]
        self.assertEqual(sent["return_value"], sid)
        self.assertEqual(sent["success_url"], f"https://site.test/provider/billing?card_setup={sid}")
        self.assertEqual(sent["failed_url"], f"https://site.test/provider/billing?card_setup={sid}&card_result=failed")
        self.assertEqual(sent["webhook_url"], "https://gw.test/api/webhooks/cardcom")

    def test_a_contractor_returns_to_its_own_billing_page(self):
        self.start(entity_type="contractor")
        self.assertIn("https://site.test/billing?card_setup=", self.page.await_args.kwargs["success_url"])

    def test_without_the_two_addresses_no_page_is_opened(self):
        for missing in ("FRONTEND_URL", "PUBLIC_API_URL"):
            with mock.patch.dict(os.environ, {missing: ""}):
                with self.assertRaises(card_setup.CardSetupUnavailable):
                    asyncio.run(card_setup.start("service_provider", PROVIDER))
        self.page.assert_not_awaited()
        self.assertEqual(self.db.setups, {})


class CompleteTest(Base):
    def test_a_confirmed_card_is_stored_for_the_entity_on_our_row(self):
        sid = self.start()["setup_id"]
        out = self.complete(sid)
        self.assertEqual(out["status"], "completed")
        self.assertEqual(len(self.db.methods), 1)
        card = self.db.methods[0]
        self.assertEqual((card["entity_type"], card["entity_id"]), ("service_provider", PROVIDER))
        self.assertEqual(out["payment_method_id"], card["id"])
        self.assertEqual((card["last_4_digits"], card["card_brand"], card["expiry_month"], card["expiry_year"]),
                         ("0042", "visa", 7, 2028))
        self.result.assert_awaited_once_with("lp-1")

    def test_the_token_is_encrypted_before_it_is_written(self):
        self.complete(self.start()["setup_id"])
        self.assertEqual(self.db.methods[0]["provider_token"], "enc(tok-secret)")

    def test_a_second_completion_asks_nobody_and_changes_nothing(self):
        sid = self.start()["setup_id"]
        first = self.complete(sid)
        again = self.complete(sid)
        self.assertEqual(again, first)
        self.assertEqual(len(self.db.methods), 1)
        self.result.assert_awaited_once()

    def test_when_two_completions_race_one_card_is_stored(self):
        sid = self.start()["setup_id"]
        stale = card_setup.load(setup_id=sid)          # both read "pending"
        winner = asyncio.run(card_setup.complete(dict(stale)))
        loser = asyncio.run(card_setup.complete(dict(stale)))
        self.assertEqual(loser, winner)
        self.assertEqual(len(self.db.methods), 1)

    def test_a_new_card_replaces_the_old_one(self):
        first = self.complete(self.start()["setup_id"])
        self.page.return_value = {"low_profile_id": "lp-2", "url": "u"}
        second = self.complete(self.start()["setup_id"])
        active = [m for m in self.db.methods if not m["deleted"]]
        self.assertEqual([m["id"] for m in active], [second["payment_method_id"]])
        old = next(m for m in self.db.methods if m["id"] == first["payment_method_id"])
        self.assertEqual((old["status"], old["is_default"]), ("removed", False))

    def test_another_entitys_card_is_not_touched_by_a_replacement(self):
        other = "22222222-2222-4222-8222-222222222222"
        self.complete(self.start(entity_id=other)["setup_id"])
        self.page.return_value = {"low_profile_id": "lp-2", "url": "u"}
        self.complete(self.start()["setup_id"])
        self.assertEqual(sorted(m["entity_id"] for m in self.db.methods if not m["deleted"]), sorted([PROVIDER, other]))

    def test_an_unfinished_page_stays_pending_and_stores_nothing(self):
        sid = self.start()["setup_id"]
        self.result.side_effect = CardcomPendingError("not yet", code="5117")
        self.assertEqual(self.complete(sid)["status"], "pending")
        self.assertEqual((self.db.setups[sid]["status"], self.db.methods), ("pending", []))

    def test_a_page_cardcom_reports_failed_is_recorded_with_its_reason(self):
        sid = self.start()["setup_id"]
        self.result.side_effect = CardcomApiError("GetLpResult error", code="5001", description="כרטיס לא תקין")
        out = self.complete(sid)
        self.assertEqual((out["status"], out["reason"]), ("failed", "כרטיס לא תקין"))
        self.assertEqual(self.db.methods, [])

    def test_when_cardcom_is_unreachable_the_row_stays_pending(self):
        sid = self.start()["setup_id"]
        self.result.side_effect = CardcomNetworkError("timeout")
        with self.assertRaises(CardcomNetworkError):
            self.complete(sid)
        self.assertEqual(self.db.setups[sid]["status"], "pending")

    def test_a_result_that_names_another_setup_stores_nothing(self):
        sid = self.start()["setup_id"]
        self.result.return_value = {**CARD, "return_value": "someone-elses-setup"}
        out = self.complete(sid)
        self.assertEqual((out["status"], out["reason"]), ("failed", "return_value_mismatch"))
        self.assertEqual(self.db.methods, [])

    def test_a_result_without_a_token_stores_nothing(self):
        sid = self.start()["setup_id"]
        self.result.return_value = {**CARD, "token": None, "return_value": sid}
        self.assertEqual(self.complete(sid)["reason"], "no_token_in_result")
        self.assertEqual(self.db.methods, [])

    def test_a_page_opened_in_one_mode_is_not_finished_in_the_other(self):
        sid = self.start()["setup_id"]
        with mock.patch.object(card_setup, "PAYMENT_FAKE_MODE", True):
            out = self.complete(sid)
        self.assertEqual((out["status"], out["reason"]), ("failed", "payment_mode_changed"))
        self.result.assert_not_awaited()
        self.assertEqual(self.db.methods, [])


class FakeModeTest(Base):
    fake_mode = True

    def test_the_browser_goes_straight_to_our_own_return_page(self):
        self.page.side_effect = lambda **kw: {"low_profile_id": "FAKE-1", "url": kw["success_url"]}
        out = self.start()
        self.assertEqual(out["url"], f"/provider/billing?card_setup={out['setup_id']}")
        self.assertEqual(out["mode"], "fake")
        self.assertEqual(self.page.await_args.kwargs["webhook_url"], "")
        self.assertTrue(self.db.setups[out["setup_id"]]["is_fake"])

    def test_it_needs_no_address_settings(self):
        with mock.patch.dict(os.environ, {"FRONTEND_URL": "", "PUBLIC_API_URL": ""}):
            self.assertIn("setup_id", self.start())

    def test_the_fake_result_has_no_return_value_and_still_completes(self):
        sid = self.start()["setup_id"]
        self.result.return_value = {**CARD, "token": "FAKE_TOKEN_x", "card_brand": "fake", "return_value": None}
        self.assertEqual(self.complete(sid)["status"], "completed")


if __name__ == "__main__":
    unittest.main()
