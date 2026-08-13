"""S1 unit test — LLM enum guard.

Runs standalone with `python -m unittest app.services.test_query_rewriter`
from the user-org service root. No pytest dependency.

Focus: an Anthropic response that returns invented codes (`laborer`,
`CHN`, `merkaz`) must not reach the SQL WHERE. After `_validate_enums`
runs, all three enum fields must be None, so the search picks up the
full inventory instead of silently going to zero rows.
"""
import json
import os
import unittest
from unittest.mock import MagicMock, patch

# Force real mode + provide a fake key so rewrite_real actually runs
# the LLM branch. The mock below intercepts the actual HTTP call.
os.environ["ANTHROPIC_API_KEY"] = "sk-test-fixture"
os.environ["LLM_REWRITER_FAKE_MODE"] = "0"

from app.services import query_rewriter as qr  # noqa: E402


def _fake_anthropic_response(payload: dict) -> MagicMock:
    """Build the shape resp.content[0].text expects."""
    content = MagicMock()
    content.text = json.dumps(payload)
    resp = MagicMock()
    resp.content = [content]
    return resp


class ValidateEnumsTest(unittest.TestCase):
    def test_invented_codes_all_drop_to_none(self):
        d = {
            "ad_type": "worker",
            "profession_code": "laborer",       # not in worker_db.profession_types
            "origin_country": "CHN",            # should be CN
            "region": "merkaz",                 # should be center
            "quantity": 4,
            "canonical_query": "פועלים סינים",
        }
        out = qr._validate_enums(d, "פועלים סינים")
        self.assertIsNone(out["profession_code"])
        self.assertIsNone(out["origin_country"])
        self.assertIsNone(out["region"])
        # quantity is a plain int — untouched.
        self.assertEqual(out["quantity"], 4)
        # ad_type valid → unchanged.
        self.assertEqual(out["ad_type"], "worker")

    def test_valid_codes_pass_through(self):
        d = {
            "ad_type": "worker",
            "profession_code": "scaffolding",  # valid
            "origin_country": "CN",             # valid
            "region": "center",                 # valid
            "quantity": 4,
            "canonical_query": "רתכים סינים במרכז",
        }
        out = qr._validate_enums(d, "רתכים סינים במרכז")
        self.assertEqual(out["profession_code"], "scaffolding")
        self.assertEqual(out["origin_country"], "CN")
        self.assertEqual(out["region"], "center")

    def test_quantity_bounds_and_coercion(self):
        d = {"ad_type": "worker", "quantity": "12"}
        self.assertEqual(qr._validate_enums(d, "")["quantity"], 12)
        d = {"ad_type": "worker", "quantity": 0}
        self.assertIsNone(qr._validate_enums(d, "")["quantity"])
        d = {"ad_type": "worker", "quantity": 10000}
        self.assertIsNone(qr._validate_enums(d, "")["quantity"])
        d = {"ad_type": "worker", "quantity": "abc"}
        self.assertIsNone(qr._validate_enums(d, "")["quantity"])

    def test_hallucinated_extra_keys_stripped(self):
        d = {
            "ad_type": "worker",
            "profession_code": "scaffolding",
            "experience_years": 5,       # invented — not in our schema
            "budget_nis": 12000,          # invented
        }
        out = qr._validate_enums(d, "")
        self.assertNotIn("experience_years", out)
        self.assertNotIn("budget_nis", out)
        self.assertEqual(out["profession_code"], "scaffolding")

    def test_ad_type_falls_back_to_worker(self):
        d = {"ad_type": "commercial", "profession_code": "scaffolding"}
        out = qr._validate_enums(d, "")
        self.assertEqual(out["ad_type"], "worker")


class QuantityExtractionTest(unittest.TestCase):
    """S3 — quantity must anchor on a count noun (or be leading)."""

    def test_bare_number_mid_sentence_ignored(self):
        # Duration / experience — not a headcount.
        self.assertIsNone(qr._quantity("פועלים סינים ל-3 חודשים"))
        self.assertIsNone(qr._quantity("רתך עם 10 שנות ניסיון"))
        self.assertIsNone(qr._quantity("פרויקט של 5 קומות"))

    def test_leading_integer_taken(self):
        self.assertEqual(qr._quantity("20 פועלים"), 20)
        self.assertEqual(qr._quantity("4 פועלים סינים לריצוף"), 4)

    def test_number_before_count_noun_taken(self):
        self.assertEqual(qr._quantity("צריך 15 עובדים למרכז"), 15)
        self.assertEqual(qr._quantity("מקום ל-6 מיטות"), 6)
        self.assertEqual(qr._quantity("דירה עם 3 חדרים"), 3)

    def test_no_digits_returns_none(self):
        self.assertIsNone(qr._quantity("חשמלאים במרכז"))


class RewriteRealEndToEndTest(unittest.TestCase):
    """Prove the pipeline: fake Anthropic returns garbage → merge → validate
    → final dict has no invented codes reaching SQL."""

    def test_llm_garbage_scrubbed_before_return(self):
        payload = {
            "ad_type": "worker",
            "profession_code": "laborer",
            "origin_country": "CHN",
            "region": "merkaz",
            "quantity": 4,
            "canonical_query": "פועלים סינים",
        }
        # `Anthropic` is imported INSIDE rewrite_real, so patch the source
        # module (`anthropic.Anthropic`) — patching the qr namespace would
        # miss because the symbol only exists post-import at call time.
        with patch("anthropic.Anthropic") as MockClient:
            instance = MockClient.return_value
            instance.messages.create.return_value = _fake_anthropic_response(payload)
            # Bypass the Redis cache read for a deterministic run.
            with patch("app.services.query_rewriter._redis_client", return_value=None):
                out = qr.rewrite_real("פועלים סינים")
        self.assertIsNone(out["profession_code"])
        self.assertIsNone(out["origin_country"])
        self.assertIsNone(out["region"])
        self.assertEqual(out["ad_type"], "worker")


if __name__ == "__main__":
    unittest.main()
