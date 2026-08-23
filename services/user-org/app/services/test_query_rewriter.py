"""Unit tests for query_rewriter.

Runs standalone with `python -m unittest app.services.test_query_rewriter`
from the user-org service root. No pytest dependency.

Post-RW contract:
  * `_validate_enums` MUST NOT return None when fake has a valid guess.
    LLM garbage falls back to fake's extraction ("LLM can only improve,
    never worsen"). Pre-RW the guard nulled every invalid LLM value —
    that was wrong because the merge already overwrote fake's guess,
    so a Hebrew-display-name from the LLM wiped a correct extraction.
  * Quantity is ALWAYS computed from `_quantity(query)`. The LLM's
    quantity is ignored — the LLM ignored the S3 "adjacent to a count
    noun" rule and extracted counts from durations. Extractor is
    deterministic + free.
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


class ValidateEnumsFallbackTest(unittest.TestCase):
    """RW — invalid LLM value falls back to fake's value, not None."""

    def test_llm_hebrew_display_falls_back_to_fake_scaffolding(self):
        """'רתך' → LLM returns 'רתכים' (Hebrew display) → post-guard
        must still be 'scaffolding' because fake extracts it from the
        PROFESSION_KEYWORDS table."""
        query = "רתך"
        fake = qr.rewrite_fake(query)                # {profession_code: 'scaffolding', ...}
        d = {**fake, "profession_code": "רתכים"}     # LLM overwrite
        out = qr._validate_enums(d, query, fake)
        self.assertEqual(out["profession_code"], "scaffolding")

    def test_llm_hebrew_origin_falls_back_to_fake_cn(self):
        """'פועלים סינים' → LLM returns origin 'סין' → post-guard must
        still be 'CN' via fake's ORIGIN_KEYWORDS extraction."""
        query = "פועלים סינים"
        fake = qr.rewrite_fake(query)                # {origin_country: 'CN', profession_code: 'general', ...}
        d = {**fake, "origin_country": "סין", "profession_code": "פועלים כלליים"}
        out = qr._validate_enums(d, query, fake)
        self.assertEqual(out["origin_country"], "CN")
        self.assertEqual(out["profession_code"], "general")

    def test_llm_hebrew_ad_type_falls_back_to_housing(self):
        """'דיור למרכז' → LLM returns 'מגורים' → post-guard must be
        'housing' via fake's HOUSING_KEYWORDS extraction, NOT the
        default 'worker' pin. This was the 'דיור למרכז' → 20 worker
        results bug pre-RW."""
        query = "דיור למרכז"
        fake = qr.rewrite_fake(query)                # {ad_type: 'housing', region: 'center', ...}
        d = {**fake, "ad_type": "מגורים"}            # LLM's garbage overwrite
        out = qr._validate_enums(d, query, fake)
        self.assertEqual(out["ad_type"], "housing")

    def test_llm_quantity_from_duration_dropped(self):
        """'פועלים ל-3 חודשים' → LLM returns quantity=3 → post-guard
        must be None because _quantity finds no count-noun anchor."""
        query = "פועלים ל-3 חודשים"
        fake = qr.rewrite_fake(query)
        d = {**fake, "quantity": 3}
        out = qr._validate_enums(d, query, fake)
        self.assertIsNone(out["quantity"])

    def test_llm_valid_codes_pass_through(self):
        query = "רתכים סינים במרכז"
        fake = qr.rewrite_fake(query)
        d = {
            "ad_type": "worker",
            "profession_code": "scaffolding",  # already valid — no fallback needed
            "origin_country": "CN",             # valid
            "region": "center",                 # valid
            "quantity": 4,
            "canonical_query": query,
        }
        out = qr._validate_enums(d, query, fake)
        self.assertEqual(out["profession_code"], "scaffolding")
        self.assertEqual(out["origin_country"], "CN")
        self.assertEqual(out["region"], "center")

    def test_ad_type_pins_to_worker_only_when_fake_also_useless(self):
        """Empty query → fake yields ad_type='worker' (the _ad_type
        default when no HOUSING_KEYWORDS match). Invalid LLM value
        falls back to fake's 'worker' — the final pin never fires."""
        query = ""
        fake = qr.rewrite_fake(query)
        d = {"ad_type": "commercial", "profession_code": "scaffolding"}
        out = qr._validate_enums(d, query, fake)
        self.assertEqual(out["ad_type"], "worker")

    def test_llm_null_field_keeps_fake_guess(self):
        """LLM returned None for a field — fake's guess stays via the
        merge; _validate_enums doesn't touch it."""
        query = "רתך"
        fake = qr.rewrite_fake(query)  # profession_code=scaffolding
        d = {**fake, "profession_code": None}
        # In practice the merge in rewrite_real drops None values before
        # they land in d — but _validate_enums must not crash either way.
        out = qr._validate_enums(d, query, fake)
        self.assertIsNone(out["profession_code"])  # LLM said null → we honour it

    def test_hallucinated_extra_keys_stripped(self):
        query = "רתכים"
        fake = qr.rewrite_fake(query)
        d = {
            **fake,
            "profession_code": "scaffolding",
            "experience_years": 5,       # invented — not in our schema
            "budget_nis": 12000,          # invented
        }
        out = qr._validate_enums(d, query, fake)
        self.assertNotIn("experience_years", out)
        self.assertNotIn("budget_nis", out)
        self.assertEqual(out["profession_code"], "scaffolding")


class QuantityExtractionTest(unittest.TestCase):
    """S3 — quantity anchors on a count noun (or leads the query)."""

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
    """Pipeline test — fake Anthropic returns Hebrew display names,
    validate falls back to fake's extracted codes, final dict carries
    real English codes for the SQL layer."""

    def test_hebrew_display_names_replaced_by_fake_extraction(self):
        payload = {
            "ad_type": "worker",
            "profession_code": "רתכים",   # Hebrew display — invalid enum
            "origin_country": "סין",       # Hebrew display — invalid enum
            "region": "מרכז",              # Hebrew display — invalid enum
            "quantity": 4,                # LLM ignores S3 rule
            "canonical_query": "רתך סיני במרכז",
        }
        with patch("anthropic.Anthropic") as MockClient:
            instance = MockClient.return_value
            instance.messages.create.return_value = _fake_anthropic_response(payload)
            with patch("app.services.query_rewriter._redis_client", return_value=None):
                out = qr.rewrite_real("רתך סיני במרכז")
        # Fake extracts scaffolding+CN+center from the query — those
        # survive despite the LLM overwrite because _validate_enums
        # rewinds invalid LLM values to fake's guess.
        self.assertEqual(out["profession_code"], "scaffolding")
        self.assertEqual(out["origin_country"], "CN")
        self.assertEqual(out["region"], "center")
        self.assertEqual(out["ad_type"], "worker")
        # _quantity finds "4" but only anchored to a count noun. Here
        # "רתך סיני במרכז" has no digit → None.
        self.assertIsNone(out["quantity"])

    def test_housing_query_survives_llm_worker_default(self):
        """'דיור למרכז' — fake produces ad_type=housing. Even if the
        LLM confuses ad_type, the fallback restores housing."""
        payload = {
            "ad_type": "מגורים",        # invalid — Hebrew display
            "region": "center",
            "canonical_query": "דיור למרכז",
        }
        with patch("anthropic.Anthropic") as MockClient:
            instance = MockClient.return_value
            instance.messages.create.return_value = _fake_anthropic_response(payload)
            with patch("app.services.query_rewriter._redis_client", return_value=None):
                out = qr.rewrite_real("דיור למרכז")
        self.assertEqual(out["ad_type"], "housing")
        self.assertEqual(out["region"], "center")


if __name__ == "__main__":
    unittest.main()
