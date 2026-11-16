"""R34 5a · the plan's owner manages it: renewal on, upgrade, cancel.
And the rule that makes cancel mean something: a listing going back to
'active' takes a slot on a running plan, the way a new listing does.

The handlers run against a scripted cursor; nothing here touches MySQL.
"""
import unittest
from decimal import Decimal
from unittest import mock

from fastapi import HTTPException

from app.routes import marketplace, marketplace_subscriptions as subs
from app.routes.marketplace import ListingUpdate, update_listing
from app.routes.marketplace_subscriptions import UpgradeRequest
from app.routes.test_provider_plans import CORP, FUTURE, PAST, PROVIDER, Cursor, _conn

CONTRACTOR = {"x_entity_id": "con-1", "x_entity_type": "contractor", "x_org_id": "con-1"}

PLAN = {
    "id": "sub-1", "advertiser_entity_type": "service_provider", "advertiser_entity_id": "prov-1",
    "category_code": "equipment", "tier_id": "tier-1", "slot_count": 5, "duration_days": 30,
    "price_nis": Decimal("149.00"), "promo_note": "launch_free_promo", "status": "active",
    "auto_renew": 1, "cardcom_token_ref": None, "payment_transaction_id": None, "is_current": 1,
}
BIGGER = {"id": "tier-2", "category_code": "equipment", "slot_count": 20, "duration_days": 30,
          "price_nis": Decimal("399.00"), "tier_active": 1, "category_active": 1}

PLAN_LOOKUP = "WHERE s.id = %s AND s.advertiser_entity_type = %s AND s.advertiser_entity_id = %s"


class CountingCursor(Cursor):
    """A Cursor whose UPDATEs report a scripted number of rows."""

    def __init__(self, rules, rowcounts=()):
        super().__init__(rules)
        self._rowcounts = list(rowcounts)

    def execute(self, sql, params=()):
        super().execute(sql, params)
        flat = " ".join(sql.split())
        for needle, n in self._rowcounts:
            if needle in flat:
                self.rowcount = n


def _manage_rules(plan=PLAN, tier=BIGGER, promo=FUTURE):
    return [
        ("FROM org_db.service_providers", [{"status": "active"}]),
        ("FROM org_db.contractors", [{"verification_tier": "tier_2"}]),
        (PLAN_LOOKUP, [plan] if plan else []),
        ("FROM marketplace_subscription_tiers t", [tier] if tier else []),
        ("launch_promo_end", [{"setting_val": promo}] if promo else []),
        ("UPDATE marketplace_subscriptions", []),
        ("UPDATE marketplace_listings", []),
        ("SELECT * FROM marketplace_subscriptions WHERE id=%s", [{"id": "sub-1", "slot_count": 20}]),
    ]


class UpgradeTest(unittest.TestCase):
    def _upgrade(self, cursor, fake_mode=False, tier_id="tier-2", **headers):
        self.conn = _conn(cursor)
        with mock.patch.object(subs, "get_db", return_value=self.conn), \
             mock.patch.object(subs, "PAYMENT_FAKE_MODE", fake_mode):
            return subs.upgrade_subscription("sub-1", UpgradeRequest(tier_id=tier_id), **headers)

    def _refused(self, cursor, status, code=None, **kwargs):
        with self.assertRaises(HTTPException) as ctx:
            self._upgrade(cursor, **kwargs)
        self.assertEqual(ctx.exception.status_code, status)
        if code:
            detail = ctx.exception.detail
            self.assertEqual(detail["code"] if isinstance(detail, dict) else detail, code)
        self.assertEqual(cursor.ran("UPDATE"), [])
        self.assertEqual(cursor.ran("INSERT"), [])

    def test_provider_during_the_promo_moves_to_the_bigger_tier(self):
        cur = Cursor(_manage_rules())
        out = self._upgrade(cur, **PROVIDER)
        self.assertEqual(out["slot_count"], 20)
        sql, params = cur.ran("UPDATE marketplace_subscriptions")[0]
        self.assertEqual(params, ("tier-2", 20, 30, Decimal("399.00"), "sub-1"))
        # the same row: its end date, its promo note and its listings stay
        self.assertNotIn("expires_at", sql)
        self.assertNotIn("promo_note", sql)
        self.assertEqual(cur.ran("UPDATE marketplace_listings"), [])
        self.conn.commit.assert_called_once()

    def test_the_plan_is_looked_up_for_this_caller_only(self):
        cur = Cursor(_manage_rules())
        self._upgrade(cur, **PROVIDER)
        _, params = cur.ran(PLAN_LOOKUP)[0]
        self.assertEqual(params, ("sub-1", "service_provider", "prov-1"))

    def test_someone_elses_plan_is_404(self):
        self._refused(Cursor(_manage_rules(plan=None)), 404, "subscription_not_found", **PROVIDER)

    def test_a_plan_that_has_ended_is_409(self):
        self._refused(Cursor(_manage_rules(plan={**PLAN, "is_current": 0})), 409,
                      "subscription_not_active", **PROVIDER)

    def test_a_tier_of_another_category_is_409(self):
        self._refused(Cursor(_manage_rules(tier={**BIGGER, "category_code": "services"})), 409,
                      "tier_category_mismatch", **PROVIDER)

    def test_the_same_size_or_smaller_is_not_an_upgrade(self):
        for slots in (5, 3):
            self._refused(Cursor(_manage_rules(tier={**BIGGER, "slot_count": slots})), 409,
                          "not_an_upgrade", **PROVIDER)

    def test_a_tier_that_is_off_or_free_is_410(self):
        self._refused(Cursor(_manage_rules(tier={**BIGGER, "tier_active": 0})), 410, **PROVIDER)
        self._refused(Cursor(_manage_rules(tier={**BIGGER, "category_active": 0})), 410, **PROVIDER)
        self._refused(Cursor(_manage_rules(tier={**BIGGER, "price_nis": Decimal("0")})), 410, **PROVIDER)

    def test_an_unknown_tier_is_404(self):
        self._refused(Cursor(_manage_rules(tier=None)), 404, "tier_not_found", **PROVIDER)

    def test_after_the_promo_a_providers_upgrade_is_refused_and_nothing_is_charged(self):
        # R37 4.1.2 · a purchase is charged after the promo; an upgrade
        # is not, because what it costs mid-period is not decided. The
        # refusal no longer says "no online payment", which stopped
        # being true.
        for promo in (PAST, None):
            for fake_mode in (False, True):
                self._refused(Cursor(_manage_rules(promo=promo)), 409, "paid_upgrade_unsupported",
                              fake_mode=fake_mode, **PROVIDER)

    def test_the_promo_is_the_providers_only(self):
        plan = {**PLAN, "advertiser_entity_type": "contractor", "advertiser_entity_id": "con-1"}
        self._refused(Cursor(_manage_rules(plan=plan)), 503, "cardcom_not_configured", **CONTRACTOR)


class CancelTest(unittest.TestCase):
    def _cancel(self, cursor, **headers):
        self.conn = _conn(cursor)
        with mock.patch.object(subs, "get_db", return_value=self.conn):
            return subs.cancel_subscription("sub-1", **headers)

    def test_the_plan_ends_and_its_listings_stop_being_published(self):
        cur = CountingCursor(_manage_rules(), rowcounts=[("UPDATE marketplace_listings", 3)])
        out = self._cancel(cur, **PROVIDER)
        self.assertEqual(out, {"id": "sub-1", "status": "cancelled", "listings_paused": 3})

        sql, params = cur.ran("UPDATE marketplace_listings")[0]
        self.assertIn("SET status = 'paused'", sql)
        # only this plan's listings, only the ones that were published
        self.assertIn("WHERE subscription_id = %s", sql)
        self.assertIn("status = 'active'", sql)
        self.assertIn("deleted_at IS NULL", sql)
        self.assertEqual(params, ("sub-1",))

        sql, params = cur.ran("UPDATE marketplace_subscriptions")[0]
        self.assertIn("status = 'cancelled'", sql)
        self.assertIn("cancelled_at = NOW()", sql)
        self.assertIn("auto_renew = FALSE", sql)
        self.assertEqual(params, ("sub-1",))
        self.conn.commit.assert_called_once()

    def test_nothing_is_deleted(self):
        cur = CountingCursor(_manage_rules(), rowcounts=[("UPDATE marketplace_listings", 2)])
        self._cancel(cur, **PROVIDER)
        self.assertEqual(cur.ran("DELETE"), [])
        self.assertEqual([s for s, _ in cur.executed if "deleted_at =" in s or "deleted_at=" in s], [])

    def _refused(self, cursor, status, code, **headers):
        with self.assertRaises(HTTPException) as ctx:
            self._cancel(cursor, **headers)
        self.assertEqual(ctx.exception.status_code, status)
        detail = ctx.exception.detail
        self.assertEqual(detail["code"] if isinstance(detail, dict) else detail, code)
        self.assertEqual(cursor.ran("UPDATE"), [])
        self.conn.commit.assert_not_called()

    def test_someone_elses_plan_is_404(self):
        self._refused(Cursor(_manage_rules(plan=None)), 404, "subscription_not_found", **PROVIDER)

    def test_a_plan_that_already_ended_is_409(self):
        self._refused(Cursor(_manage_rules(plan={**PLAN, "is_current": 0})), 409,
                      "subscription_not_active", **PROVIDER)

    def test_a_plan_that_was_paid_for_is_not_cancelled_here(self):
        for field in ("cardcom_token_ref", "payment_transaction_id"):
            self._refused(Cursor(_manage_rules(plan={**PLAN, field: "FAKE-123"})), 409,
                          "paid_plan_cancel_unsupported", **PROVIDER)

    def test_a_caller_with_no_business_is_refused(self):
        with self.assertRaises(HTTPException) as ctx:
            self._cancel(Cursor([]), x_entity_id=None, x_entity_type=None, x_org_id=None)
        self.assertEqual(ctx.exception.status_code, 403)


class AutoRenewOnTest(unittest.TestCase):
    def _on(self, cursor, **headers):
        self.conn = _conn(cursor)
        with mock.patch.object(subs, "get_db", return_value=self.conn):
            return subs.enable_auto_renew("sub-1", **headers)

    def test_a_running_plan_renews_again(self):
        cur = Cursor(_manage_rules(plan={**PLAN, "auto_renew": 0}))
        self._on(cur, **PROVIDER)
        sql, params = cur.ran("UPDATE marketplace_subscriptions")[0]
        self.assertIn("auto_renew = TRUE", sql)
        self.assertEqual(params, ("sub-1",))
        self.conn.commit.assert_called_once()

    def test_not_on_a_plan_that_ended_or_is_someone_elses(self):
        for plan, status in (({**PLAN, "is_current": 0}, 409), (None, 404)):
            cur = Cursor(_manage_rules(plan=plan))
            with self.assertRaises(HTTPException) as ctx:
                self._on(cur, **PROVIDER)
            self.assertEqual(ctx.exception.status_code, status)
            self.assertEqual(cur.ran("UPDATE"), [])


class MySubscriptionsTest(unittest.TestCase):
    def test_a_lapsed_plan_is_reported_as_not_current(self):
        rows = [
            {"id": "a", "status": "active", "slot_count": 5, "is_current": 1, "tier_name_he": "בסיסי"},
            {"id": "b", "status": "active", "slot_count": 5, "is_current": 0, "tier_name_he": None},
            {"id": "c", "status": "cancelled", "slot_count": 5, "is_current": 0, "tier_name_he": "בסיסי"},
        ]
        cur = Cursor([
            ("FROM marketplace_subscriptions s", rows),
            ("SELECT COUNT(*) AS n FROM marketplace_listings", [{"n": 2}]),
        ])
        with mock.patch.object(subs, "get_db", return_value=_conn(cur)):
            out = subs.list_my_subscriptions(**PROVIDER)
        self.assertEqual([r["is_current"] for r in out], [True, False, False])
        self.assertEqual(out[0]["slots_available"], 3)
        sql, _ = cur.ran("FROM marketplace_subscriptions s")[0]
        # the same test publishing applies, computed by the database clock
        self.assertIn("(s.status = 'active' AND s.expires_at > NOW()) AS is_current", sql)
        self.assertIn("LEFT JOIN marketplace_subscription_tiers t ON t.id = s.tier_id", sql)


def _listing_row(status="paused", kind="service_provider", owner="prov-1", category="equipment"):
    return {"id": "l-1", "corporation_id": owner if kind == "corporation" else None,
            "advertiser_entity_id": owner, "advertiser_entity_type": kind,
            "category": category, "status": status}


class RepublishTest(unittest.TestCase):
    """PATCH /marketplace/{id} with status='active'."""

    def _patch(self, cursor, body, entity_id="prov-1"):
        self.conn = _conn(cursor)
        with mock.patch.object(marketplace, "get_db", return_value=self.conn):
            return update_listing("l-1", ListingUpdate(**body), x_entity_id=entity_id, x_org_id=entity_id)

    def _rules(self, row, plan=None, used=0):
        return [
            ("FROM marketplace_listings WHERE id=%s", [row]),
            ("FROM marketplace_subscriptions", [plan] if plan else []),
            ("SELECT COUNT(*) AS n FROM marketplace_listings", [{"n": used}]),
            ("UPDATE marketplace_listings", []),
        ]

    def test_a_paused_listing_comes_back_on_the_plan_that_has_room(self):
        cur = Cursor(self._rules(_listing_row(), plan={"id": "sub-9", "slot_count": 5}, used=4))
        out = self._patch(cur, {"status": "active"})
        self.assertTrue(out["updated"])
        # the plan is the listing owner's, in the listing's own category
        _, params = cur.ran("FROM marketplace_subscriptions")[0]
        self.assertEqual(params, ("service_provider", "prov-1", "equipment"))
        sql, params = cur.ran("UPDATE marketplace_listings")[0]
        self.assertIn("subscription_id=%s", sql)
        self.assertIn("status=%s", sql)
        self.assertEqual(params, ("sub-9", "active", "l-1"))

    def test_without_a_plan_it_stays_down(self):
        cur = Cursor(self._rules(_listing_row()))
        with self.assertRaises(HTTPException) as ctx:
            self._patch(cur, {"status": "active"})
        self.assertEqual(ctx.exception.status_code, 402)
        self.assertEqual(ctx.exception.detail["code"], "no_active_subscription")
        self.assertEqual(ctx.exception.detail["buy_url"], "/provider/marketplace/subscribe?category=equipment")
        self.assertEqual(cur.ran("UPDATE"), [])

    def test_a_full_plan_takes_no_more(self):
        cur = Cursor(self._rules(_listing_row(), plan={"id": "sub-9", "slot_count": 5}, used=5))
        with self.assertRaises(HTTPException) as ctx:
            self._patch(cur, {"status": "active"})
        self.assertEqual(ctx.exception.status_code, 402)
        self.assertEqual(ctx.exception.detail["code"], "no_slots_available")
        # the plan exists: the page that helps is where it is upgraded
        self.assertEqual(ctx.exception.detail["buy_url"], "/provider/billing?category=equipment")
        self.assertEqual(cur.ran("UPDATE"), [])

    def test_rented_and_sold_listings_come_back_the_same_way(self):
        for status in ("rented", "sold"):
            cur = Cursor(self._rules(_listing_row(status=status)))
            with self.assertRaises(HTTPException) as ctx:
                self._patch(cur, {"status": "active"})
            self.assertEqual(ctx.exception.status_code, 402)

    def test_a_contractor_listing_follows_the_same_rule(self):
        row = _listing_row(kind="contractor", owner="con-1")
        cur = Cursor(self._rules(row))
        with self.assertRaises(HTTPException) as ctx:
            self._patch(cur, {"status": "active"}, entity_id="con-1")
        self.assertEqual(ctx.exception.status_code, 402)
        self.assertIsNone(ctx.exception.detail["buy_url"])
        _, params = cur.ran("FROM marketplace_subscriptions")[0]
        self.assertEqual(params, ("contractor", "con-1", "equipment"))

    def _no_plan_lookup(self, row, body, entity_id="prov-1"):
        cur = Cursor(self._rules(row))
        out = self._patch(cur, body, entity_id=entity_id)
        self.assertTrue(out["updated"])
        self.assertEqual(cur.ran("FROM marketplace_subscriptions"), [])
        sql, _ = cur.ran("UPDATE marketplace_listings")[0]
        self.assertNotIn("subscription_id", sql)

    def test_pausing_asks_nothing_of_the_plan(self):
        self._no_plan_lookup(_listing_row(status="active"), {"status": "paused"})

    def test_a_listing_already_published_is_not_charged_a_second_slot(self):
        self._no_plan_lookup(_listing_row(status="active"), {"status": "active"})

    def test_editing_the_text_asks_nothing_of_the_plan(self):
        self._no_plan_lookup(_listing_row(status="paused"), {"title": "גנרטור להשכרה"})

    def test_corporation_housing_is_left_as_it_was(self):
        row = _listing_row(kind="corporation", owner="corp-1", category="housing")
        self._no_plan_lookup(row, {"status": "active"}, entity_id="corp-1")

    def test_a_legacy_row_with_no_advertiser_type_is_left_as_it_was(self):
        row = {**_listing_row(kind="corporation", owner="corp-1", category="housing"),
               "advertiser_entity_type": None, "advertiser_entity_id": None}
        self._no_plan_lookup(row, {"status": "active"}, entity_id="corp-1")

    def test_someone_elses_listing_is_403_before_any_plan_is_read(self):
        cur = Cursor(self._rules(_listing_row()))
        with self.assertRaises(HTTPException) as ctx:
            self._patch(cur, {"status": "active"}, entity_id="prov-2")
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(cur.ran("FROM marketplace_subscriptions"), [])


class NoSlotsLinkTest(unittest.TestCase):
    def test_a_new_listing_on_a_full_plan_points_to_the_plan_page(self):
        from app.routes.marketplace import ListingCreate, create_listing
        cur = Cursor([
            ("FROM marketplace_subscriptions", [{"id": "sub-1", "slot_count": 5}]),
            ("SELECT COUNT(*) AS n FROM marketplace_listings", [{"n": 5}]),
        ])
        with mock.patch.object(marketplace, "get_db", return_value=_conn(cur)):
            with self.assertRaises(HTTPException) as ctx:
                create_listing(ListingCreate(category="services", title="הסעות", audience="both"), **PROVIDER)
        self.assertEqual(ctx.exception.detail["buy_url"], "/provider/billing?category=services")


if __name__ == "__main__":
    unittest.main()
