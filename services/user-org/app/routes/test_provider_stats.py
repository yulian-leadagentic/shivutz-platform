"""R34 5c · unit tests for routes/provider_stats.py.

The pure helpers (demand_scope, demand_where, build_stats) are tested
directly. The route itself is driven through a recording fake cursor,
which is enough to pin the two things that must not regress without a
database: who is allowed in, and that every query is bound to the
caller's own id. The SQL is not executed here; that is a staging check.
"""
import json
import unittest
from datetime import date
from unittest import mock

from fastapi import HTTPException

from app.routes import provider_stats
from app.routes.provider_stats import build_stats, demand_scope, demand_where


def _listing(id_, category="transport", region=None, status="active", title="t"):
    return {"id": id_, "title": title, "category": category, "region": region, "status": status}


class DemandScopeTest(unittest.TestCase):
    def test_regions_collect_per_category(self):
        scope, source = demand_scope(
            [_listing("a", region="north"), _listing("b", region="center")], "transport",
        )
        self.assertEqual(scope, {"transport": {"north", "center"}})
        self.assertEqual(source, "listings")

    def test_null_region_makes_the_category_nationwide(self):
        scope, _ = demand_scope(
            [_listing("a", region="north"), _listing("b", region=None)], None,
        )
        self.assertEqual(scope, {"transport": None})

    def test_nationwide_sticks_whatever_the_order(self):
        scope, _ = demand_scope(
            [_listing("a", region=None), _listing("b", region="north")], None,
        )
        self.assertEqual(scope, {"transport": None})

    def test_national_code_is_nationwide(self):
        scope, _ = demand_scope([_listing("a", region="national")], None)
        self.assertEqual(scope, {"transport": None})

    def test_inactive_listings_do_not_define_scope(self):
        scope, source = demand_scope(
            [_listing("a", category="courses", status="paused")], "transport",
        )
        self.assertEqual(scope, {"transport": None})
        self.assertEqual(source, "primary_category")

    def test_no_listing_and_no_trade(self):
        self.assertEqual(demand_scope([], None), ({}, "none"))

    def test_categories_are_kept_apart(self):
        scope, _ = demand_scope(
            [_listing("a", "transport", "north"), _listing("b", "courses", None)], None,
        )
        self.assertEqual(scope, {"transport": {"north"}, "courses": None})


class DemandWhereTest(unittest.TestCase):
    def test_nationwide_category_has_no_region_predicate(self):
        sql, params = demand_where({"transport": None})
        self.assertEqual(sql, "(JSON_CONTAINS(categories, %s))")
        self.assertEqual(params, ['"transport"'])

    def test_regional_category_accepts_regionless_and_national_searches(self):
        sql, params = demand_where({"transport": {"north", "center"}})
        self.assertEqual(
            sql,
            "((JSON_CONTAINS(categories, %s) AND "
            "(region IS NULL OR region = %s OR region IN (%s,%s))))",
        )
        self.assertEqual(params, ['"transport"', "national", "center", "north"])

    def test_placeholders_match_params(self):
        sql, params = demand_where({"transport": {"north"}, "courses": None, "equipment": {"south", "center"}})
        self.assertEqual(sql.count("%s"), len(params))
        self.assertIn(" OR ", sql)

    def test_category_code_is_bound_never_inlined(self):
        sql, params = demand_where({"x') OR 1=1 -- ": None})
        self.assertNotIn("1=1", sql)
        self.assertEqual(json.loads(params[0]), "x') OR 1=1 -- ")


class BuildStatsTest(unittest.TestCase):
    SINCE = date(2026, 11, 9)

    def test_totals_are_the_sum_of_the_listings(self):
        out = build_stats(
            [_listing("a"), _listing("b")],
            [
                {"target_id": "a", "day": date(2026, 11, 9),  "impressions": 5, "opens": 2},
                {"target_id": "a", "day": date(2026, 11, 10), "impressions": 3, "opens": 0},
                {"target_id": "b", "day": date(2026, 11, 10), "impressions": 4, "opens": 1},
            ],
            [{"listing_id": "b", "day": date(2026, 11, 15), "reveals": 2}],
            self.SINCE, 7,
        )
        self.assertEqual(out["per_listing"]["a"], {"impressions": 8, "opens": 2, "reveals": 0})
        self.assertEqual(out["per_listing"]["b"], {"impressions": 4, "opens": 1, "reveals": 2})
        self.assertEqual(out["totals"], {"impressions": 12, "opens": 3, "reveals": 2})

    def test_series_is_zero_filled_and_adds_up(self):
        out = build_stats(
            [_listing("a")],
            [{"target_id": "a", "day": date(2026, 11, 10), "impressions": 3, "opens": 1}],
            [],
            self.SINCE, 7,
        )
        self.assertEqual([p["day"] for p in out["series"]], [
            "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12",
            "2026-11-13", "2026-11-14", "2026-11-15",
        ])
        self.assertEqual(sum(p["impressions"] for p in out["series"]), out["totals"]["impressions"])
        self.assertEqual(out["series"][1], {"day": "2026-11-10", "impressions": 3, "opens": 1, "reveals": 0})
        self.assertEqual(out["series"][0], {"day": "2026-11-09", "impressions": 0, "opens": 0, "reveals": 0})

    def test_decimal_and_null_sums_are_coerced(self):
        from decimal import Decimal
        out = build_stats(
            [_listing("a")],
            [{"target_id": "a", "day": self.SINCE, "impressions": Decimal("7"), "opens": None}],
            [], self.SINCE, 7,
        )
        self.assertEqual(out["totals"], {"impressions": 7, "opens": 0, "reveals": 0})

    def test_rows_for_a_foreign_listing_or_day_are_ignored(self):
        out = build_stats(
            [_listing("a")],
            [
                {"target_id": "someone-else", "day": self.SINCE, "impressions": 99, "opens": 99},
                {"target_id": "a", "day": date(2026, 1, 1), "impressions": 99, "opens": 99},
            ],
            [{"listing_id": "someone-else", "day": self.SINCE, "reveals": 99}],
            self.SINCE, 7,
        )
        self.assertEqual(out["totals"], {"impressions": 0, "opens": 0, "reveals": 0})

    def test_no_listings(self):
        out = build_stats([], [], [], self.SINCE, 30)
        self.assertEqual(out["totals"], {"impressions": 0, "opens": 0, "reveals": 0})
        self.assertEqual(len(out["series"]), 30)
        self.assertEqual(out["per_listing"], {})


class _RecordingCursor:
    """Answers each query by the table it reads and keeps (sql, params)
    so the test can check what was bound."""

    def __init__(self, provider, listings, events=(), reveals=(), searches=0):
        self.provider, self.listings = provider, list(listings)
        self.events, self.reveals, self.searches = list(events), list(reveals), searches
        self.calls: list = []
        self._rows: list = []

    def execute(self, sql, params=()):
        self.calls.append((sql, tuple(params)))
        if "FROM service_providers" in sql:
            self._rows = [self.provider] if self.provider else []
        elif "FROM marketplace_listings" in sql:
            self._rows = self.listings
        elif "FROM promo_events" in sql:
            self._rows = self.events
        elif "FROM marketplace_reveals" in sql:
            self._rows = self.reveals
        elif "FROM search_log" in sql:
            self._rows = [{"n": self.searches}]
        elif "FROM marketplace_categories" in sql:
            self._rows = [{"code": "transport", "name_he": "הסעות"}]
        else:
            raise AssertionError(f"unexpected query: {sql}")

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return self._rows


def _conn(cursor):
    conn = mock.MagicMock()
    conn.cursor.return_value = cursor
    return conn


class RouteAuthTest(unittest.TestCase):
    def _assert_refused_before_db(self, status, **kwargs):
        with mock.patch.object(provider_stats, "get_db") as get_db:
            with self.assertRaises(HTTPException) as ctx:
                provider_stats.provider_stats(**kwargs)
        self.assertEqual(ctx.exception.status_code, status)
        get_db.assert_not_called()

    def test_anonymous_is_403(self):
        self._assert_refused_before_db(403, days=30, x_entity_id=None, x_entity_type=None)

    def test_contractor_and_corporation_are_403(self):
        self._assert_refused_before_db(403, days=30, x_entity_id="e1", x_entity_type="contractor")
        self._assert_refused_before_db(403, days=30, x_entity_id="e1", x_entity_type="corporation")

    def test_provider_type_without_an_id_is_403(self):
        self._assert_refused_before_db(403, days=30, x_entity_id=None, x_entity_type="service_provider")

    def test_other_windows_are_400(self):
        self._assert_refused_before_db(400, days=14, x_entity_id="p1", x_entity_type="service_provider")
        self._assert_refused_before_db(400, days=0,  x_entity_id="p1", x_entity_type="service_provider")

    def test_missing_provider_row_is_404(self):
        cursor = _RecordingCursor(provider=None, listings=[])
        with mock.patch.object(provider_stats, "get_db", return_value=_conn(cursor)):
            with self.assertRaises(HTTPException) as ctx:
                provider_stats.provider_stats(days=30, x_entity_id="p1", x_entity_type="service_provider")
        self.assertEqual(ctx.exception.status_code, 404)
        # Nothing past the provider lookup ran.
        self.assertEqual(len(cursor.calls), 1)


class RouteQueryBindingTest(unittest.TestCase):
    TODAY = date(2026, 11, 15)

    def _run(self, days=7, **cursor_kwargs):
        cursor = _RecordingCursor(
            provider={"primary_category": "transport", "today": self.TODAY},
            **cursor_kwargs,
        )
        conn = _conn(cursor)
        with mock.patch.object(provider_stats, "get_db", return_value=conn):
            out = provider_stats.provider_stats(
                days=days, x_entity_id="p1", x_entity_type="service_provider",
            )
        conn.close.assert_called_once()
        return out, cursor

    def _call(self, cursor, table):
        return next((sql, params) for sql, params in cursor.calls if f"FROM {table}" in sql)

    def test_every_query_is_bound_to_the_caller(self):
        out, cursor = self._run(
            listings=[_listing("l1", region="north"), _listing("l2", status="paused")],
            events=[{"target_id": "l1", "day": date(2026, 11, 14), "impressions": 6, "opens": 2}],
            reveals=[{"listing_id": "l1", "day": date(2026, 11, 15), "reveals": 1}],
            searches=9,
        )
        since = date(2026, 11, 9)

        _, params = self._call(cursor, "service_providers")
        self.assertEqual(params, ("p1",))

        sql, params = self._call(cursor, "marketplace_listings")
        self.assertIn("advertiser_entity_type = 'service_provider'", sql)
        self.assertIn("advertiser_entity_id   = %s", sql)
        self.assertEqual(params, ("p1",))

        sql, params = self._call(cursor, "promo_events")
        self.assertIn("target_type = 'marketplace_listing'", sql)
        self.assertEqual(params, ("l1", "l2", since))

        sql, params = self._call(cursor, "marketplace_reveals")
        self.assertEqual(params, ("l1", "l2", since, "p1"))

        sql, params = self._call(cursor, "search_log")
        self.assertEqual(sql.count("%s"), len(params))
        self.assertEqual(
            params,
            (since, "service_provider", "admin", '"transport"', "national", "north"),
        )

        self.assertEqual(out["days"], 7)
        self.assertEqual(out["since"], "2026-11-09")
        self.assertEqual(out["until"], "2026-11-15")
        self.assertEqual(out["totals"], {"impressions": 6, "opens": 2, "reveals": 1, "searches": 9})
        self.assertEqual(out["listings"][0], {
            "id": "l1", "title": "t", "category": "transport", "category_name": "הסעות",
            "region": "north", "status": "active",
            "impressions": 6, "opens": 2, "reveals": 1,
        })
        self.assertEqual(out["listings"][1]["impressions"], 0)
        self.assertEqual(len(out["series"]), 7)
        self.assertEqual(out["search_scope"], {
            "source": "listings",
            "categories": [{"code": "transport", "name": "הסעות", "regions": ["north"]}],
        })

    def test_no_listings_skips_the_listing_queries_and_uses_the_trade(self):
        out, cursor = self._run(days=30, listings=[], searches=4)
        tables = " ".join(sql for sql, _ in cursor.calls)
        self.assertNotIn("FROM promo_events", tables)
        self.assertNotIn("FROM marketplace_reveals", tables)
        self.assertEqual(out["totals"], {"impressions": 0, "opens": 0, "reveals": 0, "searches": 4})
        self.assertEqual(out["listings"], [])
        self.assertEqual(len(out["series"]), 30)
        self.assertEqual(out["since"], "2026-10-17")
        self.assertEqual(out["search_scope"]["source"], "primary_category")
        self.assertEqual(out["search_scope"]["categories"][0]["regions"], None)

    def test_response_carries_counts_only(self):
        out, _ = self._run(
            listings=[_listing("l1")],
            reveals=[{"listing_id": "l1", "day": self.TODAY, "reveals": 3}],
        )
        blob = json.dumps(out, ensure_ascii=False)
        for forbidden in ("viewer", "session", "actor", "query", "phone"):
            self.assertNotIn(forbidden, blob)


if __name__ == "__main__":
    unittest.main()
