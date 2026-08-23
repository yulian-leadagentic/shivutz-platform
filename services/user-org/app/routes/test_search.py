"""NM — unit tests for the near-match second pass in routes/search.py.

Tests the pure helpers (_build_where, _order_clause) without hitting
MySQL. The full second-pass logic is covered end-to-end by staging
probes against the real DB (see the RW/NM report), not here — mocking
pymysql for this is more brittle than valuable.
"""
import unittest

from app.routes.search import (
    _build_where,
    _order_clause,
    NM_RELAX_ORDER,
    NEAR_MATCH_TRIGGER,
    NEAR_MATCH_LIMIT,
    NM_MAX_ATTEMPTS,
)


class BuildWhereTest(unittest.TestCase):
    """Every clause is emitted for the filters the query names, and
    drop_field silently removes exactly one filter. profession_code
    and ad_type never drop even if a caller mistakenly names them."""

    def test_all_filters_present_when_none_dropped(self):
        wheres, params = _build_where({
            "ad_type": "worker",
            "profession_code": "scaffolding",
            "origin_country":  "CN",
            "region":          "center",
            "quantity":        5,
        })
        # 4 base clauses (ad_type, active, deleted_at, expires_at)
        # + 4 filter clauses.
        self.assertEqual(len(wheres), 8)
        self.assertIn("a.profession_code IS NULL OR a.profession_code = %s",
                      " ".join(wheres))
        self.assertIn("a.origin_country IS NULL OR a.origin_country = %s",
                      " ".join(wheres))
        self.assertIn("a.region IS NULL OR a.region = %s",
                      " ".join(wheres))
        self.assertIn("a.quantity IS NULL OR a.quantity >= %s",
                      " ".join(wheres))
        self.assertEqual(params, ["worker", "scaffolding", "CN", "center", 5])

    def test_drop_origin_removes_only_that_clause(self):
        wheres, params = _build_where({
            "ad_type": "worker",
            "profession_code": "scaffolding",
            "origin_country":  "CN",
            "region":          "center",
        }, drop_field="origin_country")
        joined = " ".join(wheres)
        self.assertIn("a.profession_code", joined)     # intent — always kept
        self.assertNotIn("a.origin_country", joined)   # dropped
        self.assertIn("a.region",           joined)    # kept
        # ad_type + scaffolding + center — origin no longer bound.
        self.assertEqual(params, ["worker", "scaffolding", "center"])

    def test_drop_quantity_removes_only_that_clause(self):
        wheres, params = _build_where({
            "ad_type": "worker",
            "profession_code": "general",
            "quantity": 20,
        }, drop_field="quantity")
        joined = " ".join(wheres)
        self.assertNotIn("a.quantity",           joined)
        self.assertNotIn("a.available_beds",     joined)
        self.assertEqual(params, ["worker", "general"])

    def test_housing_uses_available_beds_for_quantity(self):
        wheres, params = _build_where({
            "ad_type": "housing",
            "quantity": 4,
        })
        joined = " ".join(wheres)
        self.assertIn("a.available_beds IS NULL OR a.available_beds >= %s", joined)
        self.assertEqual(params, ["housing", 4])

    def test_profession_code_never_dropped_even_when_named(self):
        # Guardrail — the caller shouldn't ask for this, but if it does
        # the intent-preserving filter still fires.
        wheres, _ = _build_where({
            "ad_type": "worker",
            "profession_code": "electrician",
            "quantity": 5,
        }, drop_field="profession_code")
        self.assertIn("a.profession_code IS NULL OR a.profession_code = %s",
                      " ".join(wheres))


class OrderClauseTest(unittest.TestCase):
    def test_quantity_relaxed_worker_orders_by_quantity_desc(self):
        c = _order_clause("quantity", "worker")
        self.assertIn("quantity DESC", c)

    def test_quantity_relaxed_housing_orders_by_available_beds_desc(self):
        c = _order_clause("quantity", "housing")
        self.assertIn("available_beds DESC", c)

    def test_default_order_when_nothing_relaxed(self):
        c = _order_clause(None, "worker")
        self.assertIn("featured_until", c)
        self.assertIn("published_at",   c)

    def test_default_order_when_origin_relaxed(self):
        # Only quantity gets the special ordering; origin/region relax
        # fall back to the default boosted+recency order.
        c = _order_clause("origin_country", "worker")
        self.assertIn("featured_until", c)


class ContractConstantsTest(unittest.TestCase):
    """These constants encode product decisions — a shifted value here
    would silently change the near-match behaviour. Lock them in."""

    def test_relax_order_never_includes_intent_fields(self):
        # profession_code + ad_type are the query's intent — NEVER
        # relaxed. Regression check.
        self.assertNotIn("profession_code", NM_RELAX_ORDER)
        self.assertNotIn("ad_type",         NM_RELAX_ORDER)

    def test_relax_order_priority_matches_spec(self):
        # Per docs/cc-prompts (RW/NM): quantity → origin → region.
        self.assertEqual(NM_RELAX_ORDER, ("quantity", "origin_country", "region"))

    def test_trigger_at_three(self):
        self.assertEqual(NEAR_MATCH_TRIGGER, 3)

    def test_at_most_two_attempts(self):
        self.assertEqual(NM_MAX_ATTEMPTS, 2)

    def test_near_match_cap_at_ten(self):
        self.assertEqual(NEAR_MATCH_LIMIT, 10)


if __name__ == "__main__":
    unittest.main()
