"""R33 B · a provider publishes only in a category where it has a plan.

Covers the three places the rule lives:
  * create_listing          the provider-free bypass is gone
  * purchase / quote        a provider can add a category; during the
                            launch promo that writes the promo row
  * services/provider_plans the shared pieces

The handlers run against a scripted cursor; nothing here touches MySQL.
The same code is run against a real MySQL in the R33 report.
"""
import unittest
from datetime import datetime, timedelta
from decimal import Decimal
from unittest import mock

from fastapi import HTTPException

from app.routes import marketplace, marketplace_subscriptions as subs
from app.routes.marketplace import ListingCreate, create_listing
from app.routes.marketplace_subscriptions import PurchaseRequest, QuoteRequest
from app.services import provider_plans
from app.services.provider_plans import (
    PROVIDER_BLOCKED_CATEGORIES, insert_promo_plan, is_paid_tier, launch_promo_end,
)

PROVIDER = {"x_entity_id": "prov-1", "x_entity_type": "service_provider", "x_org_id": "prov-1"}
CORP     = {"x_entity_id": "corp-1", "x_entity_type": "corporation",      "x_org_id": "corp-1"}
FUTURE = (datetime.utcnow() + timedelta(days=40)).strftime("%Y-%m-%d")
PAST   = (datetime.utcnow() - timedelta(days=2)).strftime("%Y-%m-%d")


class Cursor:
    """Answers a query by the first rule whose text appears in the SQL.
    A rule's answer is a list of rows, or a callable(params) -> rows."""

    def __init__(self, rules):
        self.rules = list(rules)
        self.executed = []
        self._rows = []
        self.rowcount = 1

    def execute(self, sql, params=()):
        flat = " ".join(sql.split())
        self.executed.append((flat, tuple(params or ())))
        for needle, answer in self.rules:
            if needle in flat:
                self._rows = list(answer(params) if callable(answer) else answer)
                return
        raise AssertionError(f"unexpected query: {flat[:160]}")

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return list(self._rows)

    def ran(self, needle):
        return [(sql, params) for sql, params in self.executed if needle in sql]


def _conn(cursor):
    conn = mock.MagicMock()
    conn.cursor.return_value = cursor
    return conn


def _listing(category="services"):
    return ListingCreate(category=category, title="הסעות עובדים")


class CreateListingTest(unittest.TestCase):
    def _post(self, cursor, body, **headers):
        conn = _conn(cursor)
        with mock.patch.object(marketplace, "get_db", return_value=conn):
            return create_listing(body, **headers), conn

    def test_provider_without_a_plan_is_402_with_the_buy_page(self):
        cur = Cursor([("FROM marketplace_subscriptions", [])])
        with self.assertRaises(HTTPException) as ctx:
            self._post(cur, _listing("services"), **PROVIDER)
        self.assertEqual(ctx.exception.status_code, 402)
        detail = ctx.exception.detail
        self.assertEqual(detail["code"], "no_active_subscription")
        self.assertEqual(detail["category"], "services")
        self.assertEqual(detail["buy_url"], "/provider/marketplace/subscribe?category=services")
        self.assertEqual(cur.ran("INSERT INTO marketplace_listings"), [])
        # the plan was looked up for THIS provider in THIS category
        sql, params = cur.ran("FROM marketplace_subscriptions")[0]
        self.assertEqual(params, ("service_provider", "prov-1", "services"))
        self.assertIn("status = 'active'", sql)
        self.assertIn("expires_at > NOW()", sql)

    def test_a_plan_in_another_category_does_not_count(self):
        def only_equipment(params):
            return [{"id": "sub-eq", "slot_count": 5}] if params[2] == "equipment" else []
        cur = Cursor([("FROM marketplace_subscriptions", only_equipment)])
        with self.assertRaises(HTTPException) as ctx:
            self._post(cur, _listing("services"), **PROVIDER)
        self.assertEqual(ctx.exception.status_code, 402)

    def test_provider_with_a_plan_publishes_and_the_listing_is_linked(self):
        cur = Cursor([
            ("FROM marketplace_subscriptions", [{"id": "sub-1", "slot_count": 5}]),
            ("SELECT COUNT(*) AS n FROM marketplace_listings", [{"n": 2}]),
            ("INSERT INTO marketplace_listings", []),
        ])
        out, conn = self._post(cur, _listing("services"), **PROVIDER)
        self.assertEqual(out["subscription_id"], "sub-1")
        self.assertEqual(out["slots_used"], 3)
        self.assertEqual(out["slot_count"], 5)
        sql, params = cur.ran("INSERT INTO marketplace_listings")[0]
        # (id, corporation_id, subscription_id, advertiser_entity_type, advertiser_entity_id, ...)
        self.assertIsNone(params[1])
        self.assertEqual(params[2], "sub-1")
        self.assertEqual(params[3:5], ("service_provider", "prov-1"))
        conn.commit.assert_called_once()

    def test_slots_exhausted_is_402_and_nothing_is_written(self):
        cur = Cursor([
            ("FROM marketplace_subscriptions", [{"id": "sub-1", "slot_count": 5}]),
            ("SELECT COUNT(*) AS n FROM marketplace_listings", [{"n": 5}]),
        ])
        with self.assertRaises(HTTPException) as ctx:
            self._post(cur, _listing("services"), **PROVIDER)
        self.assertEqual(ctx.exception.status_code, 402)
        detail = ctx.exception.detail
        self.assertEqual(detail["code"], "no_slots_available")
        self.assertEqual((detail["slot_count"], detail["slots_used"]), (5, 5))
        self.assertEqual(detail["buy_url"], "/provider/billing?category=services")
        self.assertEqual(cur.ran("INSERT INTO"), [])
        self.assertEqual(cur.ran("UPDATE"), [])
        self.assertEqual(cur.ran("DELETE"), [])

    def test_provider_cannot_publish_housing_or_worker(self):
        for category in sorted(PROVIDER_BLOCKED_CATEGORIES):
            cur = Cursor([])
            with self.assertRaises(HTTPException) as ctx:
                self._post(cur, _listing(category), **PROVIDER)
            self.assertEqual(ctx.exception.status_code, 403)
            self.assertEqual(ctx.exception.detail["code"], "provider_category_forbidden")
            self.assertEqual(cur.executed, [])

    def test_corporation_housing_is_still_free_and_unlinked(self):
        cur = Cursor([("INSERT INTO marketplace_listings", [])])
        out, _ = self._post(cur, _listing("housing"), **CORP)
        self.assertIsNone(out["subscription_id"])
        self.assertIsNone(out["slots_used"])
        self.assertEqual(cur.ran("FROM marketplace_subscriptions"), [])
        _, params = cur.ran("INSERT INTO marketplace_listings")[0]
        self.assertEqual(params[1], "corp-1")   # corporation_id
        self.assertIsNone(params[2])            # subscription_id

    def test_corporation_outside_housing_is_still_403(self):
        cur = Cursor([])
        with self.assertRaises(HTTPException) as ctx:
            self._post(cur, _listing("services"), **CORP)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(ctx.exception.detail["code"], "corp_housing_only")

    def test_contractor_path_is_the_same_path(self):
        cur = Cursor([("FROM marketplace_subscriptions", [])])
        with self.assertRaises(HTTPException) as ctx:
            self._post(cur, _listing("equipment"),
                       x_entity_id="con-1", x_entity_type="contractor", x_org_id="con-1")
        self.assertEqual(ctx.exception.status_code, 402)
        self.assertEqual(ctx.exception.detail["code"], "no_active_subscription")
        self.assertIsNone(ctx.exception.detail["buy_url"])


TIER = {"id": "tier-1", "category_code": "equipment", "slot_count": 5, "duration_days": 30,
        "price_nis": Decimal("149.00"), "tier_active": 1, "category_active": 1}


def _purchase_rules(tier=TIER, promo=FUTURE, existing=(), provider_status="active"):
    return [
        ("FROM org_db.service_providers", [{"status": provider_status}] if provider_status else []),
        ("FROM org_db.corporations", [{"approval_status": "approved"}]),
        ("FROM marketplace_subscription_tiers t", [tier] if tier else []),
        ("launch_promo_end", [{"setting_val": promo}] if promo else []),
        ("AND category_code = %s AND status = 'active' AND expires_at > NOW()", list(existing)),
        ("INSERT INTO marketplace_subscriptions", []),
        ("SELECT * FROM marketplace_subscriptions WHERE id=%s", [{"id": "new-sub", "status": "active"}]),
    ]


class PurchaseTest(unittest.TestCase):
    def _buy(self, cursor, fake_mode=False, **headers):
        with mock.patch.object(subs, "get_db", side_effect=lambda: _conn(cursor)), \
             mock.patch.object(subs, "PAYMENT_FAKE_MODE", fake_mode):
            return subs.purchase_subscription(PurchaseRequest(tier_id="tier-1"), **headers)

    def test_provider_during_the_promo_gets_the_promo_row_without_fake_mode(self):
        cur = Cursor(_purchase_rules())
        out = self._buy(cur, fake_mode=False, **PROVIDER)
        self.assertEqual(out["id"], "new-sub")
        sql, params = cur.ran("INSERT INTO marketplace_subscriptions")[0]
        self.assertIn("'service_provider'", sql)
        self.assertIn("'active'", sql)
        # (id, provider, category, tier, slots, days, price, note, expires_at)
        self.assertEqual(params[1:8], ("prov-1", "equipment", "tier-1", 5, 30, Decimal("149.00"), "launch_free_promo"))
        self.assertEqual(params[8].strftime("%Y-%m-%d"), FUTURE)

    def test_the_row_is_the_one_registration_writes(self):
        # Both go through insert_promo_plan, so there is one INSERT to
        # compare against rather than two that could drift.
        cur = Cursor([("INSERT INTO marketplace_subscriptions", [])])
        end = datetime.strptime(FUTURE, "%Y-%m-%d")
        insert_promo_plan(cur, "prov-1", {**TIER}, end)
        reg_sql, reg_params = cur.executed[0]
        cur2 = Cursor(_purchase_rules())
        self._buy(cur2, **PROVIDER)
        buy_sql, buy_params = cur2.ran("INSERT INTO marketplace_subscriptions")[0]
        self.assertEqual(reg_sql, buy_sql)
        self.assertEqual(reg_params[1:], buy_params[1:])   # all but the generated id

    def test_provider_after_the_promo_stops_at_payment(self):
        for promo in (PAST, None, "not-a-date"):
            cur = Cursor(_purchase_rules(promo=promo))
            with self.assertRaises(HTTPException) as ctx:
                self._buy(cur, fake_mode=False, **PROVIDER)
            self.assertEqual(ctx.exception.status_code, 503, promo)
            self.assertEqual(ctx.exception.detail["code"], "cardcom_not_configured")
            self.assertEqual(cur.ran("INSERT INTO"), [])

    def test_provider_cannot_buy_housing(self):
        cur = Cursor(_purchase_rules(tier={**TIER, "category_code": "housing"}))
        with self.assertRaises(HTTPException) as ctx:
            self._buy(cur, **PROVIDER)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(ctx.exception.detail["code"], "provider_category_forbidden")
        self.assertEqual(cur.ran("INSERT INTO"), [])

    def test_provider_cannot_buy_a_zero_price_tier(self):
        cur = Cursor(_purchase_rules(tier={**TIER, "price_nis": Decimal("0.00")}))
        with self.assertRaises(HTTPException) as ctx:
            self._buy(cur, **PROVIDER)
        self.assertEqual(ctx.exception.status_code, 410)

    def test_inactive_tier_or_category_is_410(self):
        for tier in ({**TIER, "tier_active": 0}, {**TIER, "category_active": 0}):
            cur = Cursor(_purchase_rules(tier=tier))
            with self.assertRaises(HTTPException) as ctx:
                self._buy(cur, **PROVIDER)
            self.assertEqual(ctx.exception.status_code, 410)

    def test_a_second_plan_in_the_same_category_is_409(self):
        cur = Cursor(_purchase_rules(existing=[{"id": "sub-old"}]))
        with self.assertRaises(HTTPException) as ctx:
            self._buy(cur, **PROVIDER)
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(cur.ran("INSERT INTO"), [])

    def test_suspended_or_missing_provider_is_turned_away(self):
        cur = Cursor(_purchase_rules(provider_status="suspended"))
        with self.assertRaises(HTTPException) as ctx:
            self._buy(cur, **PROVIDER)
        self.assertEqual(ctx.exception.status_code, 403)
        cur = Cursor(_purchase_rules(provider_status=None))
        with self.assertRaises(HTTPException) as ctx:
            self._buy(cur, **PROVIDER)
        self.assertEqual(ctx.exception.status_code, 404)
        self.assertEqual(ctx.exception.detail, "provider_not_found")

    def test_corporation_gets_no_promo(self):
        cur = Cursor(_purchase_rules())
        with self.assertRaises(HTTPException) as ctx:
            self._buy(cur, fake_mode=False, **CORP)
        self.assertEqual(ctx.exception.status_code, 503)
        self.assertEqual(cur.ran("launch_promo_end"), [])
        self.assertEqual(cur.ran("INSERT INTO"), [])

    def test_quote_tells_a_provider_when_the_promo_ends(self):
        row = {"tier_id": "tier-1", "name_he": "בסיסי", "name_en": "Basic", "slot_count": 5,
               "duration_days": 30, "price_nis": Decimal("149.00"), "tier_active": 1,
               "category_code": "equipment", "category_name_he": "ציוד", "category_active": 1}
        rules = [r for r in _purchase_rules() if "subscription_tiers t" not in r[0]]
        rules.insert(0, ("FROM marketplace_subscription_tiers t", [row]))
        with mock.patch.object(subs, "get_db", side_effect=lambda: _conn(Cursor(rules))):
            out = subs.quote_subscription(QuoteRequest(tier_id="tier-1"), **PROVIDER)
            self.assertEqual(out["promo_end"], FUTURE)
            self.assertEqual(out["tier"]["price_nis"], 149.0)
            corp = subs.quote_subscription(QuoteRequest(tier_id="tier-1"), **CORP)
            self.assertIsNone(corp["promo_end"])


class HelpersTest(unittest.TestCase):
    def test_launch_promo_end(self):
        def end(val):
            return launch_promo_end(Cursor([("launch_promo_end", [{"setting_val": val}] if val is not None else [])]))
        self.assertEqual(end(FUTURE).strftime("%Y-%m-%d"), FUTURE)
        self.assertIsNone(end(PAST))
        self.assertIsNone(end(None))
        self.assertIsNone(end(""))
        self.assertIsNone(end("31/12/2026"))

    def test_is_paid_tier(self):
        self.assertTrue(is_paid_tier({"is_active": 1, "price_nis": Decimal("99.00")}))
        self.assertFalse(is_paid_tier({"is_active": 1, "price_nis": Decimal("0.00")}))
        self.assertFalse(is_paid_tier({"is_active": 0, "price_nis": Decimal("99.00")}))
        self.assertFalse(is_paid_tier({"is_active": 1, "price_nis": None}))

    def test_blocked_categories(self):
        self.assertEqual(provider_plans.PROVIDER_BLOCKED_CATEGORIES, frozenset({"housing", "worker"}))


if __name__ == "__main__":
    unittest.main()
