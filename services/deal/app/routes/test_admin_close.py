"""R37 Part 5 item 6 · POST /tenders/{id}/admin-close on an id that does
not exist answers 404. It used to answer 200 "closed": the UPDATE
matched nothing and nobody looked (R33 finding 6)."""
import sys
import types
import unittest
from unittest import mock

from fastapi import HTTPException

try:
    import aio_pika  # noqa: F401
except ModuleNotFoundError:
    # A machine without the broker client can still run this: the route
    # under test publishes nothing.
    _publisher = types.ModuleType("app.publisher")
    _publisher.publish_event = lambda *args, **kwargs: None
    sys.modules.setdefault("app.publisher", _publisher)

from app.routes import tenders  # noqa: E402


class _Cursor:
    def __init__(self, exists):
        self.exists = exists
        self.executed = []

    def execute(self, sql, params=()):
        self.executed.append((" ".join(sql.split()), tuple(params)))

    def fetchone(self):
        return {"id": "t-1"} if self.exists else None


def _close(cursor, **headers):
    conn = mock.MagicMock()
    conn.cursor.return_value = cursor
    with mock.patch.object(tenders, "get_db", return_value=conn):
        return tenders.admin_close("t-1", **headers), conn


ADMIN = {"x_user_role": "corporation", "x_user_is_admin": "1"}


class AdminCloseTest(unittest.TestCase):
    def test_an_unknown_request_is_404_and_nothing_is_written(self):
        cursor = _Cursor(exists=False)
        with self.assertRaises(HTTPException) as ctx:
            _close(cursor, **ADMIN)
        self.assertEqual(ctx.exception.status_code, 404)
        self.assertEqual(ctx.exception.detail, "tender_not_found")
        self.assertEqual([sql for sql, _ in cursor.executed if sql.startswith("UPDATE")], [])

    def test_an_existing_request_is_closed(self):
        cursor = _Cursor(exists=True)
        out, conn = _close(cursor, **ADMIN)
        self.assertEqual(out, {"ok": True, "status": "closed"})
        self.assertEqual(cursor.executed[0], ("SELECT id FROM foreign_tenders WHERE id=%s", ("t-1",)))
        self.assertTrue(cursor.executed[1][0].startswith("UPDATE foreign_tenders SET status='closed'"))
        conn.commit.assert_called_once()

    def test_closing_twice_is_still_200(self):
        # Already closed is not "not found". The row is there.
        cursor = _Cursor(exists=True)
        _close(cursor, **ADMIN)
        out, _ = _close(cursor, **ADMIN)
        self.assertEqual(out["status"], "closed")

    def test_a_non_admin_is_refused_before_the_database(self):
        cursor = _Cursor(exists=True)
        with self.assertRaises(HTTPException) as ctx:
            _close(cursor, x_user_role="corporation", x_user_is_admin=None)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(cursor.executed, [])


if __name__ == "__main__":
    unittest.main()
