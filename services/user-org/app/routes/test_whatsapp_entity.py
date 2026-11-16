"""R38 · the entity a user's phone speaks for on WhatsApp.

Locked here:
  * which entity counts: the only one, the flagged one, or none (the
    chat then asks the user to pick)
  * a user can point it only at one of his own active, accepted
    memberships, and moving it clears the old flag first
  * /me needs a logged-in user; /{user_id} needs a platform admin
  * the /me routes are matched before /{user_id}

The handlers run against a scripted cursor; nothing here touches MySQL.
The schema side (one flag per user, never on an inactive or pending
row) is migration 110, run against MySQL 8.0 in the R38 report.
"""
import unittest
from unittest import mock

from fastapi import HTTPException

from app.routes import users
from app.routes.users import WhatsAppEntityIn
from app.services import whatsapp_entity

MEMBERSHIPS_SQL = "FROM auth_db.entity_memberships em"
CLEAR_SQL = "SET is_whatsapp_default = FALSE"
SET_SQL = "SET is_whatsapp_default = TRUE"
USER_SQL = "FROM auth_db.users WHERE id = %s"


def row(mid, entity_type="corporation", flagged=0, name=None):
    return {
        "membership_id": mid, "entity_type": entity_type, "entity_id": f"ent-{mid}",
        "role": "owner", "is_whatsapp_default": flagged, "entity_name": name or f"name-{mid}",
    }


class Cursor:
    def __init__(self, memberships=(), user_exists=True, set_rowcount=1):
        self.memberships = list(memberships)
        self.user_exists = user_exists
        self.set_rowcount = set_rowcount
        self.executed = []
        self._rows = []
        self.rowcount = 0

    def execute(self, sql, params=()):
        flat = " ".join(sql.split())
        self.executed.append((flat, tuple(params or ())))
        self.rowcount = 0
        if MEMBERSHIPS_SQL in flat:
            self._rows = list(self.memberships)
        elif USER_SQL in flat:
            self._rows = [{"id": params[0]}] if self.user_exists else []
        elif CLEAR_SQL in flat:
            self._rows = []
            self.rowcount = sum(1 for m in self.memberships if m["is_whatsapp_default"])
        elif SET_SQL in flat:
            self._rows = []
            self.rowcount = self.set_rowcount
        else:
            raise AssertionError(f"unexpected query: {flat[:160]}")

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return list(self._rows)

    def ran(self, needle):
        return [(sql, params) for sql, params in self.executed if needle in sql]


def _conn(cursor):
    conn = mock.MagicMock()
    conn.cursor.return_value = cursor
    return conn


class DescribeTest(unittest.TestCase):
    def test_one_membership_is_used_without_a_choice(self):
        out = whatsapp_entity.describe(Cursor([row("m1")]), "u1")
        self.assertEqual(out["effective_membership_id"], "m1")
        self.assertIsNone(out["default_membership_id"])
        self.assertFalse(out["choice_needed"])

    def test_several_with_a_flag_use_the_flagged_one(self):
        out = whatsapp_entity.describe(Cursor([row("m1"), row("m2", flagged=1), row("m3", "service_provider")]), "u1")
        self.assertEqual(out["default_membership_id"], "m2")
        self.assertEqual(out["effective_membership_id"], "m2")
        self.assertFalse(out["choice_needed"])
        self.assertEqual([m["membership_id"] for m in out["memberships"]], ["m1", "m2", "m3"])

    def test_several_without_a_flag_need_a_choice(self):
        out = whatsapp_entity.describe(Cursor([row("m1"), row("m2", "contractor")]), "u1")
        self.assertIsNone(out["effective_membership_id"])
        self.assertTrue(out["choice_needed"])

    def test_no_membership_needs_no_choice_and_has_no_entity(self):
        out = whatsapp_entity.describe(Cursor([]), "u1")
        self.assertEqual(out["memberships"], [])
        self.assertIsNone(out["effective_membership_id"])
        self.assertFalse(out["choice_needed"])

    def test_only_this_users_active_accepted_memberships_are_read(self):
        cur = Cursor([row("m1")])
        whatsapp_entity.describe(cur, "u1")
        sql, params = cur.ran(MEMBERSHIPS_SQL)[0]
        self.assertIn("WHERE em.user_id = %s", sql)
        self.assertIn("em.is_active = TRUE", sql)
        self.assertIn("em.invitation_accepted_at IS NOT NULL", sql)
        self.assertEqual(params, ("u1",))

    def test_the_response_names_each_entity_and_carries_no_flag_column(self):
        out = whatsapp_entity.describe(Cursor([row("m1", name="כוח אדם בע\"מ")]), "u1")
        self.assertEqual(out["memberships"][0]["entity_name"], "כוח אדם בע\"מ")
        self.assertNotIn("is_whatsapp_default", out["memberships"][0])


class SetDefaultTest(unittest.TestCase):
    def test_own_membership_clears_the_old_flag_then_sets_the_new_one(self):
        cur = Cursor([row("m1", flagged=1), row("m2")])
        conn = _conn(cur)
        whatsapp_entity.set_default(conn, "u1", "m2")
        writes = [(sql, params) for sql, params in cur.executed if sql.startswith("UPDATE")]
        self.assertEqual(len(writes), 2)
        self.assertIn(CLEAR_SQL, writes[0][0])
        self.assertEqual(writes[0][1], ("u1",))
        self.assertIn(SET_SQL, writes[1][0])
        self.assertEqual(writes[1][1], ("m2", "u1"))
        self.assertIn("is_active = TRUE", writes[1][0])
        self.assertIn("invitation_accepted_at IS NOT NULL", writes[1][0])
        conn.commit.assert_called_once()

    def test_another_users_or_an_inactive_membership_is_404_and_nothing_is_written(self):
        cur = Cursor([row("m1"), row("m2")])
        conn = _conn(cur)
        with self.assertRaises(HTTPException) as ctx:
            whatsapp_entity.set_default(conn, "u1", "someone-elses")
        self.assertEqual(ctx.exception.status_code, 404)
        self.assertEqual(ctx.exception.detail["code"], "membership_not_found")
        self.assertEqual([s for s, _ in cur.executed if s.startswith("UPDATE")], [])
        conn.commit.assert_not_called()

    def test_none_clears_the_default(self):
        cur = Cursor([row("m1", flagged=1), row("m2")])
        conn = _conn(cur)
        out = whatsapp_entity.set_default(conn, "u1", None)
        self.assertEqual(len(cur.ran(CLEAR_SQL)), 1)
        self.assertEqual(cur.ran(SET_SQL), [])
        conn.commit.assert_called_once()
        self.assertIn("memberships", out)

    def test_a_membership_that_changed_meanwhile_is_409_and_rolled_back(self):
        cur = Cursor([row("m1"), row("m2")], set_rowcount=0)
        conn = _conn(cur)
        with self.assertRaises(HTTPException) as ctx:
            whatsapp_entity.set_default(conn, "u1", "m2")
        self.assertEqual(ctx.exception.status_code, 409)
        conn.rollback.assert_called_once()
        conn.commit.assert_not_called()


class RoutesTest(unittest.TestCase):
    def _call(self, fn, cursor, *args, **kwargs):
        conn = _conn(cursor)
        with mock.patch.object(users, "get_db", return_value=conn):
            return fn(*args, **kwargs), conn

    def test_me_needs_a_logged_in_user(self):
        for fn, args in ((users.get_my_whatsapp_entity, ()), (users.set_my_whatsapp_entity, (WhatsAppEntityIn(membership_id="m1"),))):
            with self.assertRaises(HTTPException) as ctx:
                self._call(fn, Cursor([row("m1")]), *args, x_user_id=None)
            self.assertEqual(ctx.exception.status_code, 401)

    def test_me_reads_and_writes_the_callers_own_rows(self):
        cur = Cursor([row("m1"), row("m2")])
        out, _ = self._call(users.get_my_whatsapp_entity, cur, x_user_id="u1")
        self.assertEqual(out["user_id"], "u1")
        self.assertEqual(cur.ran(MEMBERSHIPS_SQL)[0][1], ("u1",))
        cur = Cursor([row("m1"), row("m2")])
        _, conn = self._call(users.set_my_whatsapp_entity, cur, WhatsAppEntityIn(membership_id="m2"), x_user_id="u1")
        self.assertEqual(cur.ran(SET_SQL)[0][1], ("m2", "u1"))
        conn.commit.assert_called_once()

    def test_another_user_is_for_admins_only(self):
        for role, flag in (("corporation", None), ("contractor", None), (None, None), ("service_provider", "0")):
            with self.assertRaises(HTTPException) as ctx:
                self._call(users.get_user_whatsapp_entity, Cursor([row("m1")]), "u2", x_user_role=role, x_user_is_admin=flag)
            self.assertEqual(ctx.exception.status_code, 403)
            with self.assertRaises(HTTPException) as ctx:
                self._call(users.set_user_whatsapp_entity, Cursor([row("m1")]), "u2", WhatsAppEntityIn(membership_id="m1"),
                           x_user_role=role, x_user_is_admin=flag)
            self.assertEqual(ctx.exception.status_code, 403)

    def test_an_admin_acting_as_a_corporation_can_read_and_set_any_user(self):
        cur = Cursor([row("m1"), row("m2")])
        out, _ = self._call(users.get_user_whatsapp_entity, cur, "u2", x_user_role="corporation", x_user_is_admin="1")
        self.assertEqual(out["user_id"], "u2")
        self.assertEqual(cur.ran(MEMBERSHIPS_SQL)[0][1], ("u2",))
        cur = Cursor([row("m1"), row("m2")])
        _, conn = self._call(users.set_user_whatsapp_entity, cur, "u2", WhatsAppEntityIn(membership_id="m1"),
                             x_user_role="admin", x_user_is_admin=None)
        self.assertEqual(cur.ran(SET_SQL)[0][1], ("m1", "u2"))
        conn.commit.assert_called_once()

    def test_an_unknown_user_is_404(self):
        with self.assertRaises(HTTPException) as ctx:
            self._call(users.get_user_whatsapp_entity, Cursor(user_exists=False), "nobody", x_user_role="admin", x_user_is_admin="1")
        self.assertEqual(ctx.exception.status_code, 404)

    def test_me_is_matched_before_the_user_id_route(self):
        paths = [(r.path, sorted(r.methods)) for r in users.router.routes]
        for method in ("GET", "PUT"):
            me = paths.index(("/me/whatsapp-entity", [method]))
            by_id = paths.index(("/{user_id}/whatsapp-entity", [method]))
            self.assertLess(me, by_id, method)


if __name__ == "__main__":
    unittest.main()
