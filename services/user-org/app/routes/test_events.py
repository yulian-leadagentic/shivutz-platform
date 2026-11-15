"""R34 5c · unit tests for the listing events added to routes/events.py.

Covers the gates that decide what may be written: the per-target
allow-list, the liveness check against the right table, and the rule
that a listing event is stored without an actor. The two POST handlers
are driven through a fake connection; nothing here touches MySQL.
"""
import asyncio
import unittest
from unittest import mock

from fastapi import HTTPException

from app.routes import events
from app.routes.events import EventBatch, EventPayload, _actor, _pair_allowed


class PairAllowedTest(unittest.TestCase):
    def test_sponsor_vocabulary_is_unchanged(self):
        for event_type in ("impression", "ad_click", "inquiry"):
            self.assertTrue(_pair_allowed(event_type, "sponsor_ad"))

    def test_listing_vocabulary(self):
        self.assertTrue(_pair_allowed("listing_impression", "marketplace_listing"))
        self.assertTrue(_pair_allowed("listing_open", "marketplace_listing"))

    def test_vocabularies_do_not_cross(self):
        self.assertFalse(_pair_allowed("impression", "marketplace_listing"))
        self.assertFalse(_pair_allowed("ad_click", "marketplace_listing"))
        self.assertFalse(_pair_allowed("listing_open", "sponsor_ad"))

    def test_reveal_is_not_an_event(self):
        # Reveals live in marketplace_reveals. Accepting one here would
        # be the double count the spec rules out.
        self.assertFalse(_pair_allowed("contact_reveal", "marketplace_listing"))
        self.assertFalse(_pair_allowed("reveal", "marketplace_listing"))

    def test_unknown_target(self):
        self.assertFalse(_pair_allowed("impression", "ad"))


class ActorTest(unittest.TestCase):
    def test_listing_events_carry_no_actor(self):
        self.assertEqual(_actor("marketplace_listing", "e1", "contractor"), (None, None))

    def test_sponsor_events_keep_the_caller(self):
        self.assertEqual(_actor("sponsor_ad", "e1", "contractor"), ("e1", "contractor"))
        self.assertEqual(_actor("sponsor_ad", None, None), (None, None))


class _FakeCursor:
    def __init__(self, live_ads=(), live_listings=()):
        self.live = {"sponsor_ads": set(live_ads), "marketplace_listings": set(live_listings)}
        self.selects: list = []
        self.inserted: list = []
        self._rows: list = []

    def execute(self, sql, params=()):
        if sql.lstrip().startswith("INSERT INTO promo_events"):
            self.inserted.append(tuple(params))
            return
        for table, live in self.live.items():
            if f"FROM {table}" in sql:
                self.selects.append((table, tuple(params)))
                self._rows = [{"id": i} for i in params if i in live]
                return
        raise AssertionError(f"unexpected query: {sql}")

    def executemany(self, sql, rows):
        assert sql.lstrip().startswith("INSERT INTO promo_events")
        self.inserted.extend(tuple(r) for r in rows)

    def fetchall(self):
        return self._rows


class _Request:
    headers: dict = {}
    client = None


def _event(event_type, target_type, target_id, **extra):
    return EventPayload(event_type=event_type, target_type=target_type, target_id=target_id, **extra)


class _HandlerCase(unittest.TestCase):
    def _patched(self, cursor):
        conn = mock.MagicMock()
        conn.cursor.return_value = cursor
        return (
            mock.patch.object(events, "get_db", return_value=conn),
            mock.patch.object(events, "_rate_limited", return_value=False),
            conn,
        )


class BatchTest(_HandlerCase):
    def _run(self, cursor, batch, **headers):
        get_db, limiter, conn = self._patched(cursor)
        with get_db, limiter:
            asyncio.run(events.record_events_batch(
                EventBatch(events=batch), _Request(),
                x_entity_id=headers.get("x_entity_id"),
                x_entity_type=headers.get("x_entity_type"),
            ))
        return conn

    def test_mixed_batch_checks_each_kind_against_its_own_table(self):
        cursor = _FakeCursor(live_ads={"ad1"}, live_listings={"l1", "l2"})
        self._run(cursor, [
            _event("impression",         "sponsor_ad",          "ad1", metadata={"placement": "inline"}),
            _event("listing_impression", "marketplace_listing", "l1", session_id="s1"),
            _event("listing_impression", "marketplace_listing", "l2"),
            _event("listing_open",       "marketplace_listing", "l1"),
            _event("listing_impression", "marketplace_listing", "gone"),
        ], x_entity_id="e1", x_entity_type="contractor")

        self.assertEqual(sorted(t for t, _ in cursor.selects), ["marketplace_listings", "sponsor_ads"])
        written = [(r[1], r[2], r[3]) for r in cursor.inserted]
        self.assertEqual(written, [
            ("impression",         "sponsor_ad",          "ad1"),
            ("listing_impression", "marketplace_listing", "l1"),
            ("listing_impression", "marketplace_listing", "l2"),
            ("listing_open",       "marketplace_listing", "l1"),
        ])

    def test_listing_rows_have_null_actor_and_sponsor_rows_keep_it(self):
        cursor = _FakeCursor(live_ads={"ad1"}, live_listings={"l1"})
        self._run(cursor, [
            _event("impression",         "sponsor_ad",          "ad1"),
            _event("listing_impression", "marketplace_listing", "l1", session_id="s1"),
        ], x_entity_id="e1", x_entity_type="contractor")
        ad_row, listing_row = cursor.inserted
        self.assertEqual(ad_row[4:6], ("e1", "contractor"))
        self.assertEqual(listing_row[4:6], (None, None))
        self.assertEqual(listing_row[6], "s1")

    def test_an_id_live_as_one_kind_cannot_vouch_for_the_other(self):
        # Same id on both sides of the batch, live only as a sponsor ad.
        cursor = _FakeCursor(live_ads={"same"}, live_listings=set())
        self._run(cursor, [
            _event("impression",         "sponsor_ad",          "same"),
            _event("listing_impression", "marketplace_listing", "same"),
        ])
        self.assertEqual([(r[1], r[2]) for r in cursor.inserted], [("impression", "sponsor_ad")])

    def test_crossed_and_unknown_pairs_never_reach_the_database(self):
        cursor = _FakeCursor(live_ads={"ad1"}, live_listings={"l1"})
        conn = self._run(cursor, [
            _event("ad_click",       "marketplace_listing", "l1"),
            _event("listing_open",   "sponsor_ad",          "ad1"),
            _event("contact_reveal", "marketplace_listing", "l1"),
        ])
        self.assertEqual(cursor.selects, [])
        self.assertEqual(cursor.inserted, [])
        conn.commit.assert_not_called()

    def test_metadata_is_still_allow_listed_for_listing_events(self):
        cursor = _FakeCursor(live_listings={"l1"})
        self._run(cursor, [
            _event("listing_impression", "marketplace_listing", "l1",
                   metadata={"placement": "marketplace", "referrer": "https://example.com"}),
        ])
        self.assertEqual(cursor.inserted[0][7], '{"placement": "marketplace"}')

    def test_rate_limited_batch_is_429(self):
        with mock.patch.object(events, "_rate_limited", return_value=True), \
             mock.patch.object(events, "get_db") as get_db:
            with self.assertRaises(HTTPException) as ctx:
                asyncio.run(events.record_events_batch(
                    EventBatch(events=[_event("listing_open", "marketplace_listing", "l1")]),
                    _Request(), x_entity_id=None, x_entity_type=None,
                ))
        self.assertEqual(ctx.exception.status_code, 429)
        get_db.assert_not_called()

    def test_batch_cap_is_unchanged(self):
        with self.assertRaises(ValueError):
            EventBatch(events=[
                _event("listing_impression", "marketplace_listing", f"l{i}") for i in range(21)
            ])


class SingleTest(_HandlerCase):
    def _run(self, cursor, event, **headers):
        get_db, limiter, conn = self._patched(cursor)
        with get_db, limiter:
            asyncio.run(events.record_event(
                event, _Request(),
                x_entity_id=headers.get("x_entity_id"),
                x_entity_type=headers.get("x_entity_type"),
            ))
        return conn

    def _code(self, cursor, event):
        with self.assertRaises(HTTPException) as ctx:
            self._run(cursor, event)
        self.assertEqual(ctx.exception.status_code, 400)
        return ctx.exception.detail["code"]

    def test_listing_open_is_written_without_an_actor(self):
        cursor = _FakeCursor(live_listings={"l1"})
        conn = self._run(cursor, _event("listing_open", "marketplace_listing", "l1"),
                         x_entity_id="e1", x_entity_type="contractor")
        (row,) = cursor.inserted
        self.assertEqual(row[1:6], ("listing_open", "marketplace_listing", "l1", None, None))
        conn.commit.assert_called_once()

    def test_sponsor_impression_still_works(self):
        cursor = _FakeCursor(live_ads={"ad1"})
        self._run(cursor, _event("impression", "sponsor_ad", "ad1"),
                  x_entity_id="e1", x_entity_type="contractor")
        (row,) = cursor.inserted
        self.assertEqual(row[1:6], ("impression", "sponsor_ad", "ad1", "e1", "contractor"))

    def test_inactive_listing_is_target_not_found(self):
        cursor = _FakeCursor(live_listings=set())
        self.assertEqual(
            self._code(cursor, _event("listing_open", "marketplace_listing", "l1")),
            "target_not_found",
        )
        self.assertEqual(cursor.inserted, [])

    def test_error_codes(self):
        cursor = _FakeCursor(live_ads={"ad1"}, live_listings={"l1"})
        self.assertEqual(self._code(cursor, _event("nonsense", "sponsor_ad", "ad1")), "event_type_not_allowed")
        self.assertEqual(self._code(cursor, _event("impression", "nonsense", "ad1")), "target_type_not_allowed")
        self.assertEqual(self._code(cursor, _event("ad_click", "marketplace_listing", "l1")), "event_type_not_allowed")
        self.assertEqual(cursor.inserted, [])


if __name__ == "__main__":
    unittest.main()
