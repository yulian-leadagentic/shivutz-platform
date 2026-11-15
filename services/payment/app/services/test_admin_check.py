"""R33 A1 · the admin gate in this service, and a lock on its readers.

See services/admin_check.py for what the two headers mean. The source
locks exist because the failure they guard against is silent: a gate
left on the role header keeps passing every test written with
`x_user_role="admin"` and only breaks for a real admin who picked an
entity before opening the admin area.
"""
import ast
import pathlib
import re
import unittest

from app.services.admin_check import is_admin

APP = pathlib.Path(__file__).resolve().parents[1]

# Admin branches that still read x-user-role, each for a reason.
LEFT_ON_PURPOSE = {
    # list_payment_methods: the admin branch does not bypass a check,
    # it lists EVERY entity's cards instead of the caller's own. On the
    # billing screen an admin acting as a corporation must see that
    # corporation's cards, so it stays on the acting role.
    "routes/payment_methods.py": 1,
}

ADMIN_BY_ROLE = re.compile(r'x_user_role[^#\n]*["\']admin["\']')


def _sources():
    for path in sorted(APP.rglob("*.py")):
        if path.name.startswith("test_") or "__pycache__" in path.parts:
            continue
        yield path, path.read_text(encoding="utf8")


class IsAdminTest(unittest.TestCase):
    def test_flag_makes_an_admin_whatever_the_acting_role(self):
        for role in ("corporation", "contractor", "service_provider", "admin", None, ""):
            self.assertTrue(is_admin("1", role), role)

    def test_role_admin_still_works_without_the_flag(self):
        self.assertTrue(is_admin(None, "admin"))

    def test_everyone_else_is_not(self):
        for role in ("corporation", "contractor", "service_provider", None, "", "Admin"):
            self.assertFalse(is_admin(None, role), role)

    def test_only_the_exact_value_counts(self):
        for flag in ("0", "true", "yes", "1 ", " 1", "11", "", 1, True):
            self.assertFalse(is_admin(flag, "corporation"), repr(flag))


class SourceLockTest(unittest.TestCase):
    def test_a_function_that_reads_the_flag_declares_it_as_a_header(self):
        problems = []
        for path, text in _sources():
            if path.name == "admin_check.py":
                continue  # the helper takes the flag as a plain argument
            for node in ast.walk(ast.parse(text)):
                if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                reads = any(
                    isinstance(n, ast.Name) and n.id == "x_user_is_admin" and isinstance(n.ctx, ast.Load)
                    for n in ast.walk(node)
                )
                if not reads:
                    continue
                args = node.args.args
                defaults = [None] * (len(args) - len(node.args.defaults)) + list(node.args.defaults)
                header = [
                    d for a, d in zip(args, defaults)
                    if a.arg == "x_user_is_admin"
                    and isinstance(d, ast.Call) and getattr(d.func, "id", None) == "Header"
                ]
                if not header:
                    problems.append(f"{path.relative_to(APP).as_posix()}:{node.lineno} {node.name}")
        self.assertEqual(problems, [])

    def test_no_admin_gate_is_left_on_the_role_header(self):
        found = {}
        for path, text in _sources():
            rel = path.relative_to(APP).as_posix()
            if rel == "services/admin_check.py":
                continue
            hits = [
                line for line in text.splitlines()
                if ADMIN_BY_ROLE.search(line) and not line.lstrip().startswith("#")
            ]
            if hits:
                found[rel] = len(hits)
        self.assertEqual(found, LEFT_ON_PURPOSE)


if __name__ == "__main__":
    unittest.main()
