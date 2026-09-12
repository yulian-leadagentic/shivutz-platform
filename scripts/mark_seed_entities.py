#!/usr/bin/env python3
"""S1 · one-time helper: flip is_seed=TRUE on the four smoke-test seeds.

The smoke test (scripts/smoke_test.py) refuses to run if any of its four
seed phones' entities have is_seed=FALSE. That guard exists because the
test hits reveal endpoints, cross-entity access endpoints, and asserts
against contact_reveals COUNTs — never the kind of thing you want
pointed at a live user's row by mistake.

This helper is the ONLY way to flip is_seed=TRUE. It reads the four
phone numbers from env vars (same names the smoke test uses), resolves
each to its entities via auth_db.users → entity_memberships → org_db,
and sets is_seed=TRUE on every contractor/corporation the phone
belongs to. Idempotent — safe to re-run.

Requires:
  MYSQL_HOST, MYSQL_PORT (optional, defaults 3306), MYSQL_USER (optional,
  defaults root), MYSQL_ROOT_PASSWORD  — DB connection.
  CONTRACTOR_APPROVED_PHONE, CONTRACTOR_PENDING_PHONE,
  CONTRACTOR_B_PHONE, CORPORATION_PHONE  — the four seed phones.

Run:
  railway ssh --service user-org 'python3 /scripts/mark_seed_entities.py'

Nothing else in the app reads is_seed today — this flag is currently
consumed only by scripts/smoke_test.py. If that changes, add a note to
this file so the next reader knows the blast radius grew.
"""
import os
import re
import sys
from typing import Dict, List, Tuple

import pymysql


PHONE_ENVS = [
    "CONTRACTOR_APPROVED_PHONE",
    "CONTRACTOR_PENDING_PHONE",
    "CONTRACTOR_B_PHONE",
    "CORPORATION_PHONE",
]


def normalise_phone(raw: str) -> str:
    digits = re.sub(r"\D", "", raw or "")
    if digits.startswith("972") and len(digits) == 12:
        return "+" + digits
    if digits.startswith("0") and len(digits) == 10:
        return "+972" + digits[1:]
    raise ValueError(f"phone does not look Israeli: {_redact(raw)}")


def _redact(phone: str) -> str:
    if not phone:
        return "(unset)"
    return phone[:5] + "***" + phone[-2:] if len(phone) > 7 else "***"


def _connect(db: str) -> pymysql.Connection:
    return pymysql.connect(
        host=os.environ["MYSQL_HOST"],
        port=int(os.environ.get("MYSQL_PORT", "3306")),
        user=os.environ.get("MYSQL_USER", "root"),
        password=os.environ["MYSQL_ROOT_PASSWORD"],
        database=db,
        charset="utf8mb4",
        autocommit=True,
    )


def resolve_entities(phone: str) -> List[Tuple[str, str]]:
    """Return [(entity_type, entity_id)] for every active membership on phone."""
    auth = _connect("auth_db")
    try:
        cur = auth.cursor()
        cur.execute(
            "SELECT id FROM users WHERE phone=%s AND deleted_at IS NULL LIMIT 1",
            (phone,),
        )
        row = cur.fetchone()
        if not row:
            return []
        user_id = row[0]
        cur.execute(
            """SELECT entity_type, entity_id
                 FROM entity_memberships
                WHERE user_id=%s AND is_active=1
                  AND invitation_accepted_at IS NOT NULL""",
            (user_id,),
        )
        return [(r[0], r[1]) for r in cur.fetchall()]
    finally:
        auth.close()


def mark_seed(entity_type: str, entity_id: str) -> str:
    """Flip is_seed=TRUE on the entity. Returns 'flipped' | 'already' | 'missing'."""
    table = {"contractor": "contractors", "corporation": "corporations"}[entity_type]
    org = _connect("org_db")
    try:
        cur = org.cursor()
        cur.execute(f"SELECT is_seed FROM {table} WHERE id=%s", (entity_id,))
        row = cur.fetchone()
        if not row:
            return "missing"
        if row[0]:
            return "already"
        cur.execute(f"UPDATE {table} SET is_seed=1 WHERE id=%s", (entity_id,))
        return "flipped"
    finally:
        org.close()


def main() -> int:
    missing_env = [e for e in PHONE_ENVS if not os.getenv(e)]
    if missing_env:
        print(
            "[mark-seed] FATAL: missing env vars: " + ", ".join(missing_env),
            file=sys.stderr,
        )
        return 2

    print("[mark-seed] resolving four seed phones to entities…")
    total_flipped = 0
    total_already = 0
    total_missing_users = 0
    for env_name in PHONE_ENVS:
        raw = os.environ[env_name]
        try:
            phone = normalise_phone(raw)
        except ValueError as e:
            print(f"[mark-seed] {env_name} → SKIP: {e}", file=sys.stderr)
            continue

        redacted = _redact(phone)
        entities = resolve_entities(phone)
        if not entities:
            print(f"[mark-seed] {env_name} ({redacted}) → NO USER ROW / no active memberships")
            total_missing_users += 1
            continue

        for etype, eid in entities:
            outcome = mark_seed(etype, eid)
            if outcome == "flipped":
                total_flipped += 1
            elif outcome == "already":
                total_already += 1
            # eid intentionally NOT printed — it's a UUID, not sensitive, but
            # keeping the log short + non-identifying by default.
            print(f"[mark-seed] {env_name} ({redacted}) → {etype} → {outcome}")

    print(
        f"[mark-seed] done — flipped {total_flipped}, already {total_already}, "
        f"missing-users {total_missing_users}"
    )
    return 0 if total_missing_users == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
