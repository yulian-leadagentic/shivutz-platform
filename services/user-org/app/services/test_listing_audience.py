"""R38 item 3 · who a service listing is for, and what a query word has to
be to find one.

3a · the audience rule (services/visibility.py) for every viewer, and
     the create/update validation in routes/marketplace.py.
3b · the matcher (services/search_normalize.py): a query word is a word,
     not a fragment; generic words and regions alone find nothing.

The SQL itself is run against MySQL, built from staging's tables and
seed listings, in the R38 report.

Run: python -m unittest app.services.test_listing_audience
"""
import re
import unittest

from fastapi import HTTPException

from app.routes.marketplace import _audience_or_400
from app.services.search_normalize import (
    is_generic_word,
    marketplace_text_token_clauses,
    word_pattern,
)
from app.services.visibility import LISTING_AUDIENCES, marketplace_scope_wheres


def matches(word: str, text: str) -> bool:
    """MySQL's REGEXP and Python's re agree on this pattern once the
    POSIX class is spelled out for Python."""
    pattern = word_pattern(word).replace("[^[:alnum:]]", r"[^\w]")
    return re.search(pattern, text) is not None


class WordMatchTest(unittest.TestCase):
    def test_the_report_case_no_longer_matches(self):
        listing = "חבילת ביטוח משולבת לתאגידים"
        self.assertFalse(matches("לבת", listing))   # was: inside "משולבת"
        self.assertFalse(matches("ים", listing))    # was: inside "לתאגידים"

    def test_a_city_of_two_words_still_matches_as_words(self):
        for text in ("בת ים", "דירה בבת ים", "בת-ים"):
            self.assertTrue(matches("לבת", text) or matches("בת", text), text)
            self.assertTrue(matches("ים", text), text)

    def test_prefixes_and_plural_endings_are_part_of_the_word(self):
        self.assertTrue(matches("קורסים", "קורס עברית"))
        self.assertTrue(matches("קורס", "שני קורסים"))
        self.assertTrue(matches("הסעות", "הסעה לאתר"))
        self.assertTrue(matches("ביטוח", "כולל ביטוח מלא"))
        self.assertTrue(matches("ביטוח", "והביטוח"))
        self.assertFalse(matches("ביטוח", "ביטוחניק"))

    def test_regex_characters_in_a_query_are_literal(self):
        self.assertTrue(matches("100%", "הנחה 100% השבוע"))
        self.assertFalse(matches("a.c", "abc"))


class DroppedWordsTest(unittest.TestCase):
    def test_generic_words_with_or_without_a_prefix(self):
        for w in ("עובדים", "לעובדים", "והפועלים", "זרים", "לזרים"):
            self.assertTrue(is_generic_word(w), w)
        for w in ("ביטוח", "עבודה", "קורס"):
            self.assertFalse(is_generic_word(w), w)

    def test_a_query_of_only_generic_words_or_dropped_words_has_no_clause(self):
        self.assertEqual(marketplace_text_token_clauses("עובדים זרים"), [])
        self.assertEqual(marketplace_text_token_clauses("בצפון", drop_words=frozenset({"בצפון"})), [])

    def test_a_trade_alone_comes_back(self):
        clauses = marketplace_text_token_clauses(
            "פיגומים", drop_words=frozenset({"פיגומים"}), restore_if_alone=frozenset({"פיגומים"}),
        )
        self.assertEqual(len(clauses), 1)

    def test_a_trade_next_to_a_service_word_does_not(self):
        clauses = marketplace_text_token_clauses(
            "טייח ביטוח", drop_words=frozenset({"טייח"}), restore_if_alone=frozenset({"טייח"}),
        )
        self.assertEqual(len(clauses), 1)
        self.assertIn("ביטוח", clauses[0][1][0])

    def test_every_clause_is_a_word_match_on_the_four_fields(self):
        (sql, params), = marketplace_text_token_clauses("ביטוח")
        self.assertEqual(sql.count("REGEXP"), 4)
        self.assertNotIn("LIKE", sql)
        self.assertEqual(len(set(params)), 1)


class AudienceScopeTest(unittest.TestCase):
    def scope(self, *who):
        wheres, params = marketplace_scope_wheres(*who)
        return " AND ".join(wheres), params

    def test_each_viewer_sees_its_audiences(self):
        cases = (
            (("c-1", "contractor", "contractor", "approved"), ["contractors", "both"]),
            (("k-1", "corporation", "corporation", None), ["corporations", "both"]),
            (("p-1", "service_provider", "service_provider", None), ["both"]),
            ((None, None, None, None), ["both"]),
        )
        for who, seen in cases:
            sql, params = self.scope(*who)
            self.assertIn("ml.audience IN", sql, who)
            self.assertEqual(params[: len(seen)], seen, who)

    def test_admin_sees_everything(self):
        self.assertEqual(marketplace_scope_wheres(None, None, "admin", None), ([], []))

    def test_the_advertiser_sees_its_own(self):
        sql, params = self.scope("p-1", "service_provider", "service_provider", None)
        self.assertIn("ml.advertiser_entity_id = %s AND ml.advertiser_entity_type = %s", sql)
        self.assertEqual(params[-2:], ["p-1", "service_provider"])

    def test_an_entity_type_with_no_id_is_anonymous(self):
        sql, params = self.scope(None, "corporation", "corporation", None)
        self.assertEqual(params, ["both"])
        self.assertNotIn("advertiser_entity_id", sql)

    def test_the_corporation_housing_rule_still_applies(self):
        sql, _ = self.scope(None, None, None, None)
        self.assertIn("NOT (ml.category = 'housing'", sql)


class AudienceValueTest(unittest.TestCase):
    def test_the_three_values(self):
        for value in LISTING_AUDIENCES:
            self.assertEqual(_audience_or_400(value, required=True), value)

    def test_missing_is_both_unless_required(self):
        self.assertEqual(_audience_or_400(None, required=False), "both")
        self.assertEqual(_audience_or_400("  ", required=False), "both")
        with self.assertRaises(HTTPException) as ctx:
            _audience_or_400(None, required=True)
        self.assertEqual((ctx.exception.status_code, ctx.exception.detail["code"]), (400, "audience_required"))
        self.assertIn("audience", ctx.exception.detail["fields"])

    def test_anything_else_is_refused(self):
        for value in ("everyone", "Contractors", "contractor", "קבלנים"):
            with self.assertRaises(HTTPException) as ctx:
                _audience_or_400(value, required=False)
            self.assertEqual(ctx.exception.detail["code"], "audience_invalid", value)


if __name__ == "__main__":
    unittest.main()
