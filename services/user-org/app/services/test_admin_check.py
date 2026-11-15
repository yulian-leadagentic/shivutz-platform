"""R33 A1 · the admin gate, and a lock on the places that read it.

Three kinds of test:
  1. `is_admin` itself.
  2. The helpers that took the role as an argument now take the flag
     too, and behave exactly as before for anyone who is not an admin.
  3. Two structural locks over the source of this service:
       * a function that reads `x_user_is_admin` declares it (a missing
         Header parameter would be a NameError on the first request,
         not at import time)
       * no admin check is still written against the role header,
         except the ones listed in LEFT_ON_PURPOSE with the reason

Nothing here touches MySQL.
"""
import ast
import pathlib
import re
import sys
import types
import unittest

from fastapi import HTTPException

# team_membership imports the RabbitMQ publisher at module level. Where
# aio_pika is not installed (a bare checkout, no container) that import
# would stop this whole file from collecting, for a dependency none of
# these tests exercise.
try:
    import aio_pika  # noqa: F401
except ModuleNotFoundError:
    _stub = types.ModuleType("app.publisher")
    async def _publish_event(*_args, **_kwargs):
        return None
    _stub.publish_event = _publish_event
    sys.modules.setdefault("app.publisher", _stub)

from app.routes.marketplace_admin import _require_admin
from app.services.admin_check import is_admin
from app.services.entity_access import require_entity_access
from app.services import notification_recipients, team_membership

APP = pathlib.Path(__file__).resolve().parents[1]

# Admin branches that still read x-user-role, each for a reason.
# file (relative to app/) -> how many such lines it may hold.
LEFT_ON_PURPOSE = {
    # These three pick WHICH ROWS a search or a listing page returns,
    # on screens an entity uses too. Flipping them would give an admin
    # who is acting as a corporation the admin's view of every search,
    # which is not what "acting as" means. Reported in the R33 report
    # for a decision; not an admin gate.
    "services/visibility.py": 3,
    # Same family: whether owner ids are serialised into search rows.
    "routes/search.py": 1,
    # Which searches count as customer demand. Analytics only.
    "services/search_log.py": 1,
}

ADMIN_BY_ROLE = re.compile(r'(x_user_role|caller_role)\s*(==|!=)\s*["\']admin["\']')


class IsAdminTest(unittest.TestCase):
    def test_flag_makes_an_admin_whatever_the_acting_role(self):
        for role in ("corporation", "contractor", "service_provider", "admin", None, ""):
            self.assertTrue(is_admin("1", role), role)

    def test_role_admin_still_works_without_the_flag(self):
        # An admin with no entity picked; also a gateway older than the
        # service during a rolling deploy.
        self.assertTrue(is_admin(None, "admin"))

    def test_everyone_else_is_not(self):
        for role in ("corporation", "contractor", "service_provider", None, "", "Admin", "ADMIN"):
            self.assertFalse(is_admin(None, role), role)

    def test_only_the_exact_value_counts(self):
        for flag in ("0", "true", "True", "yes", "1 ", " 1", "11", "", 1, True):
            self.assertFalse(is_admin(flag, "corporation"), repr(flag))


class RequireAdminTest(unittest.TestCase):
    def test_admin_acting_as_a_corporation_passes(self):
        _require_admin("1", "corporation")

    def test_plain_admin_passes(self):
        _require_admin(None, "admin")

    def test_corporation_is_refused(self):
        with self.assertRaises(HTTPException) as ctx:
            _require_admin(None, "corporation")
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(ctx.exception.detail, "admin_only")

    def test_no_headers_at_all_is_refused(self):
        with self.assertRaises(HTTPException) as ctx:
            _require_admin(None, None)
        self.assertEqual(ctx.exception.status_code, 403)


class EntityAccessTest(unittest.TestCase):
    def test_admin_acting_as_a_corporation_can_open_another_org(self):
        require_entity_access("corp-1", "corporation", "corporation", "corp-2", "corporation", "1")
        require_entity_access("corp-1", "corporation", "corporation", "con-9", "contractor", "1")

    def test_a_corporation_still_cannot(self):
        with self.assertRaises(HTTPException) as ctx:
            require_entity_access("corp-1", "corporation", "corporation", "corp-2", "corporation")
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(ctx.exception.detail, {"error": "not_your_entity"})
        with self.assertRaises(HTTPException) as ctx:
            require_entity_access("corp-1", "corporation", "corporation", "corp-2", "corporation", None)
        self.assertEqual(ctx.exception.detail, {"error": "not_your_entity"})

    def test_non_admin_outcomes_are_unchanged(self):
        require_entity_access("corp-1", "corporation", "corporation", "corp-1", "corporation")
        with self.assertRaises(HTTPException) as ctx:
            require_entity_access("corp-1", "corporation", "corporation", "corp-1", "contractor")
        self.assertEqual(ctx.exception.detail, {"error": "wrong_entity_type"})
        with self.assertRaises(HTTPException) as ctx:
            require_entity_access(None, None, None, "corp-1", "corporation")
        self.assertEqual(ctx.exception.status_code, 401)


class _NoMembershipCursor:
    """The caller is not a member of the entity being managed."""
    def execute(self, sql, params=()):
        self.sql = sql

    def fetchone(self):
        return None


class TeamHelpersTest(unittest.TestCase):
    def test_team_membership_admin_flag_skips_the_membership_lookup(self):
        team_membership._ensure_caller_can_manage(
            _NoMembershipCursor(), "corporation", "corp-2", "u-1", "corporation", "1")

    def test_team_membership_without_the_flag_is_refused(self):
        with self.assertRaises(HTTPException) as ctx:
            team_membership._ensure_caller_can_manage(
                _NoMembershipCursor(), "corporation", "corp-2", "u-1", "corporation")
        self.assertEqual(ctx.exception.status_code, 403)

    def test_notification_recipients_admin_flag(self):
        notification_recipients._ensure_caller_can_manage(
            _NoMembershipCursor(), "corporation", "corp-2", "u-1", "corporation", "u-2", "1")
        with self.assertRaises(HTTPException) as ctx:
            notification_recipients._ensure_caller_can_manage(
                _NoMembershipCursor(), "corporation", "corp-2", "u-1", "corporation", "u-2")
        self.assertEqual(ctx.exception.status_code, 403)


def _sources():
    for path in sorted(APP.rglob("*.py")):
        if path.name.startswith("test_") or "__pycache__" in path.parts:
            continue
        yield path, path.read_text(encoding="utf8")


class SourceLockTest(unittest.TestCase):
    def test_a_function_that_reads_the_flag_declares_it(self):
        missing = []
        for path, text in _sources():
            for node in ast.walk(ast.parse(text)):
                if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                params = {a.arg for a in node.args.args + node.args.kwonlyargs}
                for name in ("x_user_is_admin", "caller_is_admin"):
                    reads = any(
                        isinstance(n, ast.Name) and n.id == name and isinstance(n.ctx, ast.Load)
                        for n in ast.walk(node)
                    )
                    if reads and name not in params:
                        missing.append(f"{path.relative_to(APP)}:{node.lineno} {node.name} reads {name}")
        self.assertEqual(missing, [])

    def test_the_flag_arrives_as_a_header_on_every_route_that_uses_it(self):
        bad = []
        for path, text in _sources():
            if "routes" not in path.parts:
                continue
            for node in ast.walk(ast.parse(text)):
                if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                # Routes only: a private helper takes the flag as a
                # plain argument from the route that read the header.
                if not any("router." in ast.unparse(d) for d in node.decorator_list):
                    continue
                args = node.args.args
                defaults = [None] * (len(args) - len(node.args.defaults)) + list(node.args.defaults)
                for arg, default in zip(args, defaults):
                    if arg.arg != "x_user_is_admin":
                        continue
                    is_header = (
                        isinstance(default, ast.Call)
                        and getattr(default.func, "id", None) == "Header"
                    )
                    if not is_header:
                        bad.append(f"{path.relative_to(APP)}:{node.lineno} {node.name}")
        self.assertEqual(bad, [])

    def test_no_admin_gate_is_left_on_the_role_header(self):
        found = {}
        for path, text in _sources():
            rel = path.relative_to(APP).as_posix()
            hits = [
                i for i, line in enumerate(text.splitlines(), 1)
                if ADMIN_BY_ROLE.search(line) and not line.lstrip().startswith("#")
            ]
            if rel == "services/admin_check.py":
                continue
            if hits:
                found[rel] = len(hits)
        self.assertEqual(found, LEFT_ON_PURPOSE)


if __name__ == "__main__":
    unittest.main()
