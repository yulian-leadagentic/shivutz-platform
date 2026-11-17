"""POST /payments/subscriptions/cancel: only a paid period can be cancelled.

  * active or past_due with a period end: cancelled, access to the period end
  * trialing, expired, or a row with no period end: 409, nothing written
  * already cancelled: the same answer again, nothing written
  * comped: untouched, as before

Run: python -m unittest app.routes.test_subscription_cancel
"""
import unittest
from datetime import datetime, timedelta
from unittest import mock

from fastapi import HTTPException

from app.routes import subscriptions

ME = "11111111-1111-4111-8111-111111111111"
END = datetime(2026, 12, 17, 10, 0, 0)


class _Cur:
    def __init__(self, row):
        self.row = row
        self.writes = []

    def execute(self, sql, params=None):
        if sql.lstrip().upper().startswith("UPDATE"):
            self.writes.append((sql, params))

    def fetchone(self):
        return self.row


class _Conn:
    def __init__(self, row):
        self.cur = _Cur(row)
        self.commits = 0

    def cursor(self):
        return self.cur

    def commit(self):
        self.commits += 1

    def close(self):
        pass


def _cancel(row, entity_type="contractor"):
    conn = _Conn(row)
    with mock.patch.object(subscriptions, "get_db", return_value=conn):
        out = subscriptions.cancel_subscription(x_entity_id=ME, x_entity_type=entity_type)
    return out, conn


def _row(status, period_end=END, **extra):
    return {"status": status, "current_period_end": period_end, "trial_ends_at": None, "tier": "basic", **extra}


class CancelTest(unittest.TestCase):
    def test_an_active_paid_period_is_cancelled_and_keeps_its_end(self):
        out, conn = _cancel(_row("active"))
        self.assertEqual(out, {"status": "cancelled", "current_period_end": END})
        self.assertEqual(len(conn.cur.writes), 1)
        self.assertIn("status='cancelled'", conn.cur.writes[0][0])
        self.assertNotIn("current_period_end", conn.cur.writes[0][0])
        self.assertEqual(conn.commits, 1)

    def test_past_due_can_be_cancelled_too(self):
        out, conn = _cancel(_row("past_due", END - timedelta(days=3)))
        self.assertEqual(out["status"], "cancelled")
        self.assertEqual(len(conn.cur.writes), 1)

    def test_a_trial_cannot_be_cancelled_and_nothing_is_written(self):
        for row in (_row("trialing", None, trial_ends_at=END), _row("expired", END - timedelta(days=40))):
            with self.assertRaises(HTTPException) as ctx:
                _cancel(row)
            self.assertEqual((ctx.exception.status_code, ctx.exception.detail), (409, "nothing_to_cancel"))

    def test_an_active_row_with_no_period_end_cannot_be_cancelled(self):
        with self.assertRaises(HTTPException) as ctx:
            _cancel(_row("active", None))
        self.assertEqual(ctx.exception.status_code, 409)

    def test_cancelling_twice_answers_the_same_and_writes_nothing(self):
        out, conn = _cancel(_row("cancelled"))
        self.assertEqual(out, {"status": "cancelled", "current_period_end": END})
        self.assertEqual(conn.cur.writes, [])

    def test_comped_is_untouched(self):
        out, conn = _cancel(_row("comped", None))
        self.assertEqual(out, {"status": "comped"})
        self.assertEqual(conn.cur.writes, [])

    def test_no_subscription_is_404(self):
        with self.assertRaises(HTTPException) as ctx:
            _cancel(None)
        self.assertEqual(ctx.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
