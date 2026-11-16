#!/usr/bin/env python3
"""R38 item 2 · em dashes (U+2014) in text the Python services can show a user.

The JS and TS side is scripts/em-dash-scan.mjs. This is the same check for
the FastAPI services, done with `ast` so that a comment or a docstring is
never mistaken for a message.

What is reported: an em dash inside a string literal (f-strings included)
that is not a docstring and that a person can end up reading. A string
counts as readable when it has Hebrew letters in it, or when it is passed
as `detail=` / `message=` / `title=` / `subject=` / `body=` or sits under
one of those keys in a dict. English log lines are left alone: nobody but
us reads them.

    python scripts/em_dash_scan.py            list every hit, exit 1 if any
    python scripts/em_dash_scan.py --count    per-service counts only
"""
import ast
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EM_DASH = "—"
HEBREW = re.compile(r"[֐-׿]")
ROOTS = [
    "services/user-org/app",
    "services/deal/app",
    "services/payment/app",
    "services/admin/app",
    "services/worker/app",
    "scripts/seed_marketplace.py",
]
READ_BY_USERS = {"detail", "message", "title", "subject", "body", "label", "description", "text",
                 "title_he", "body_he", "message_he", "name_he", "label_he", "description_he"}
SKIP_DIRS = {"__pycache__", "tests", "maintenance"}
# Not read by a user. The query rewriter's text is the instruction sent to
# the language model, and the search engine is outside this rule's reach
# (R35 and R38 guardrails).
SKIP_FILES = {"services/user-org/app/services/query_rewriter.py"}


def python_files(root):
    path = os.path.join(REPO, root)
    if os.path.isfile(path):
        yield path
        return
    for folder, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in files:
            full = os.path.join(folder, name)
            if os.path.relpath(full, REPO).replace("\\", "/") in SKIP_FILES:
                continue
            if name.endswith(".py") and not name.startswith("test_"):
                yield full


def _docstrings(tree):
    ids = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            body = getattr(node, "body", [])
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) \
                    and isinstance(body[0].value.value, str):
                ids.add(id(body[0].value))
    return ids


def _named_for_users(tree):
    """ids of string nodes passed as detail=..., or under a 'message' key."""
    ids = set()

    def mark(value):
        for sub in ast.walk(value):
            if isinstance(sub, ast.Constant) and isinstance(sub.value, str):
                ids.add(id(sub))

    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            for kw in node.keywords:
                if kw.arg in READ_BY_USERS:
                    mark(kw.value)
        elif isinstance(node, ast.Dict):
            for key, value in zip(node.keys, node.values):
                if isinstance(key, ast.Constant) and key.value in READ_BY_USERS:
                    mark(value)
    return ids


def scan_source(path, source):
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []
    docs, named = _docstrings(tree), _named_for_users(tree)
    lines = source.split("\n")
    hits = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Constant) and isinstance(node.value, str)):
            continue
        if id(node) in docs or EM_DASH not in node.value:
            continue
        if not (HEBREW.search(node.value) or id(node) in named):
            continue
        hits.append({"file": path, "line": node.lineno, "end_line": getattr(node, "end_lineno", node.lineno),
                     "text": lines[node.lineno - 1].strip()[:200]})
    return hits


def scan_roots(roots=ROOTS):
    hits = []
    for root in roots:
        for path in python_files(root):
            source = open(path, encoding="utf8").read()
            if EM_DASH not in source:
                continue
            for hit in scan_source(path, source):
                hit["root"] = root
                hit["file"] = os.path.relpath(path, REPO).replace("\\", "/")
                hits.append(hit)
    return hits


if __name__ == "__main__":
    found = scan_roots()
    if "--count" not in sys.argv:
        for h in found:
            print(f"{h['file']}:{h['line']}  {h['text']}")
    for root in ROOTS:
        print(f"{root}: {sum(1 for h in found if h['root'] == root)}")
    print(f"total: {len(found)}")
    sys.exit(1 if found else 0)
