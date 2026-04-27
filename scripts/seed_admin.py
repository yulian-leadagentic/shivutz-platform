#!/usr/bin/env python3
"""First-deploy admin bootstrap for Shivutz on Railway.

Reads SEED_ADMIN_PHONE + SEED_ADMIN_NAME from the environment. If both are
set AND no admin user exists yet, inserts a row into `auth_db.users` with
role='admin'. Idempotent — running again with the same values is a no-op
once any admin exists.

Designed to be invoked once, manually or as a post-migration step on the
first deploy. After the admin is created, **delete the SEED_ADMIN_*
variables** from Railway so they don't leak to subsequent deploys.

The admin then logs in via the standard SMS-OTP flow at /login. The first
OTP gets them in; the system sends them an OTP via the configured SMS
provider as for any other user.

Usage:
  SEED_ADMIN_PHONE=+972501234567 SEED_ADMIN_NAME='Admin Name' \
    python scripts/seed_admin.py
"""
import os
import re
import sys
import uuid

import pymysql


def _normalise_phone(raw: str) -> str:
    """Mirror auth/otp.js normalisation: +972XXXXXXXXX."""
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("972") and len(digits) == 12:
        return "+" + digits
    if digits.startswith("0") and len(digits) == 10:
        return "+972" + digits[1:]
    raise ValueError(f"invalid phone: {raw!r}")


def main() -> int:
    phone_raw = os.getenv("SEED_ADMIN_PHONE", "").strip()
    name = os.getenv("SEED_ADMIN_NAME", "").strip()

    if not phone_raw or not name:
        print("[seed_admin] SEED_ADMIN_PHONE / SEED_ADMIN_NAME not set — skipping")
        return 0

    try:
        phone = _normalise_phone(phone_raw)
    except ValueError as e:
        print(f"[seed_admin] FATAL: {e}", file=sys.stderr)
        return 2

    conn = pymysql.connect(
        host=os.getenv("MYSQL_HOST", "mysql"),
        port=int(os.getenv("MYSQL_PORT", "3306")),
        user=os.getenv("MYSQL_USER", "root"),
        password=os.environ["MYSQL_ROOT_PASSWORD"],
        database="auth_db",
        charset="utf8mb4",
        autocommit=False,
    )
    try:
        cur = conn.cursor()

        # Already-an-admin check — idempotent.
        cur.execute("SELECT COUNT(*) FROM users WHERE role='admin' AND deleted_at IS NULL")
        if cur.fetchone()[0] > 0:
            print("[seed_admin] an admin user already exists — skipping")
            return 0

        # Phone-already-taken check — refuse rather than overwrite a real user.
        cur.execute("SELECT id, role FROM users WHERE phone=%s AND deleted_at IS NULL LIMIT 1", (phone,))
        existing = cur.fetchone()
        if existing:
            print(f"[seed_admin] phone {phone} already exists with role={existing[1]} — refusing to overwrite",
                  file=sys.stderr)
            return 1

        new_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO users (id, phone, full_name, role, auth_method, is_active)
               VALUES (%s, %s, %s, 'admin', 'sms', TRUE)""",
            (new_id, phone, name),
        )
        conn.commit()
        print(f"[seed_admin] created admin user {new_id} ({name}, {phone})")
        print("[seed_admin] DELETE the SEED_ADMIN_* env vars from Railway now.")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
