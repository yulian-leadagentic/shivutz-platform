"""R34 5c · unit tests for services/search_log.py.

The row that is written is the privacy contract of the search log, so
the tests pin what may and may not reach it. No MySQL: the write is
exercised only for the one property that matters without a database,
that it cannot raise into a search.
"""
import json
import unittest
from unittest import mock

from app.services import search_log
from app.services.search_log import matched_categories, search_row, viewer_type


class MatchedCategoriesTest(unittest.TestCase):
    def test_distinct_and_sorted(self):
        matches = [
            {"id": "1", "category": "transport"},
            {"id": "2", "category": "equipment"},
            {"id": "3", "category": "transport"},
        ]
        self.assertEqual(matched_categories(matches), ["equipment", "transport"])

    def test_no_matches_is_an_empty_list(self):
        self.assertEqual(matched_categories([]), [])
        self.assertEqual(matched_categories(None), [])

    def test_rows_without_a_usable_code_are_skipped(self):
        matches = [
            {"id": "1"},
            {"id": "2", "category": None},
            {"id": "3", "category": ""},
            {"id": "4", "category": "x" * 51},
            "not a dict",
            {"id": "5", "category": "courses"},
        ]
        self.assertEqual(matched_categories(matches), ["courses"])


class ViewerTypeTest(unittest.TestCase):
    def test_anonymous_is_none(self):
        self.assertIsNone(viewer_type(None, None))

    def test_entity_roles_pass_through(self):
        self.assertEqual(viewer_type("contractor", "contractor"), "contractor")
        self.assertEqual(viewer_type("corporation", "corporation"), "corporation")
        self.assertEqual(viewer_type("service_provider", "service_provider"), "service_provider")

    def test_admin_comes_from_the_role_header(self):
        self.assertEqual(viewer_type(None, "admin"), "admin")

    def test_unknown_role_is_not_stored(self):
        self.assertIsNone(viewer_type("something_else", "something_else"))


class SearchRowTest(unittest.TestCase):
    def test_row_shape(self):
        row = search_row(
            [{"category": "transport"}], "north", "contractor", "contractor", False,
        )
        self.assertEqual(row, ('["transport"]', "north", "contractor", 0))

    def test_no_region_and_fallback(self):
        row = search_row([], None, None, None, True)
        self.assertEqual(row, ("[]", None, None, 1))

    def test_categories_are_valid_json(self):
        row = search_row(
            [{"category": "b"}, {"category": "a"}], None, None, None, False,
        )
        self.assertEqual(json.loads(row[0]), ["a", "b"])

    def test_oversized_region_is_dropped(self):
        row = search_row([], "x" * 51, None, None, False)
        self.assertIsNone(row[1])

    def test_row_has_no_slot_for_text_or_identity(self):
        # Four values: categories, region, role, fallback flag. Anything
        # more would be a column this table was designed not to have.
        row = search_row([{"category": "transport", "title": "secret"}],
                         "north", "contractor", "contractor", False)
        self.assertEqual(len(row), 4)
        self.assertNotIn("secret", json.dumps(row))


class RecordSearchNeverRaisesTest(unittest.TestCase):
    def test_database_down(self):
        with mock.patch.object(search_log, "get_db", side_effect=RuntimeError("db down")):
            with self.assertLogs(search_log._log, level="WARNING"):
                search_log.record_search([{"category": "transport"}], "north", None, None, False)

    def test_insert_fails_and_connection_is_still_closed(self):
        conn = mock.MagicMock()
        conn.cursor.return_value.execute.side_effect = RuntimeError("no such table")
        with mock.patch.object(search_log, "get_db", return_value=conn):
            with self.assertLogs(search_log._log, level="WARNING"):
                search_log.record_search([], None, None, None, False)
        conn.close.assert_called_once()
        conn.commit.assert_not_called()

    def test_malformed_matches_do_not_raise(self):
        conn = mock.MagicMock()
        with mock.patch.object(search_log, "get_db", return_value=conn):
            with self.assertLogs(search_log._log, level="WARNING"):
                search_log.record_search(object(), None, None, None, False)
        conn.cursor.assert_not_called()

    def test_happy_path_writes_one_row(self):
        conn = mock.MagicMock()
        with mock.patch.object(search_log, "get_db", return_value=conn):
            search_log.record_search(
                [{"category": "transport"}], "north", "contractor", "contractor", False,
            )
        execute = conn.cursor.return_value.execute
        execute.assert_called_once()
        sql, params = execute.call_args[0]
        self.assertIn("INSERT INTO search_log", sql)
        self.assertEqual(params, ('["transport"]', "north", "contractor", 0))
        conn.commit.assert_called_once()
        conn.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
