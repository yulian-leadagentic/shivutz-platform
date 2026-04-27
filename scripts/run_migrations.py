#!/usr/bin/env python3
"""Idempotent SQL migration runner for Shivutz on Railway.

Picks every `db/migrations/*.sql` file in lexical order and applies the
ones that haven't been recorded in `auth_db._migrations` yet. Safe to run
on every container start — already-applied migrations are skipped without
re-executing the SQL.

Designed to be invoked from any service's container entrypoint OR as a
one-shot via `railway run python scripts/run_migrations.py`. We attach
this to the user-org service's startup (single, slow-changing service
that's always part of every environment).

Behaviour:
  - Connects to MySQL using the standard env vars (MYSQL_HOST, MYSQL_PORT,
    MYSQL_ROOT_PASSWORD).
  - Creates `auth_db` if missing (the `_migrations` ledger lives there).
  - Reads every `db/migrations/*.sql`, sorts by filename, and applies
    each that doesn't yet have a row in `_migrations`.
  - Each migration runs in its own transaction (per-statement, since
    MySQL doesn't transact DDL).
  - On failure, prints the error and exits non-zero — Railway will mark
    the deploy as failed and not flip the new revision live.

Usage:
  python scripts/run_migrations.py [--dir db/migrations]
"""
import argparse
import hashlib
import os
import sys
from pathlib import Path

import pymysql


def _env(name: str, default: str | None = None) -> str:
    v = os.getenv(name, default)
    if v is None:
        print(f"[migrations] FATAL: env var {name} is required", file=sys.stderr)
        sys.exit(2)
    return v


def _connect() -> pymysql.Connection:
    return pymysql.connect(
        host=_env("MYSQL_HOST", "mysql"),
        port=int(_env("MYSQL_PORT", "3306")),
        user=_env("MYSQL_USER", "root"),
        password=_env("MYSQL_ROOT_PASSWORD"),
        charset="utf8mb4",
        autocommit=True,
        client_flag=pymysql.constants.CLIENT.MULTI_STATEMENTS,
    )


def _ensure_ledger(conn: pymysql.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute("CREATE DATABASE IF NOT EXISTS auth_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
        cur.execute(
            """CREATE TABLE IF NOT EXISTS auth_db._migrations (
                 filename     VARCHAR(255) NOT NULL,
                 sha256       CHAR(64)     NOT NULL,
                 applied_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                 PRIMARY KEY (filename)
               ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"""
        )


def _applied_filenames(conn: pymysql.Connection) -> set[str]:
    with conn.cursor() as cur:
        cur.execute("SELECT filename, sha256 FROM auth_db._migrations")
        return {row[0]: row[1] for row in cur.fetchall()}


def _record(conn: pymysql.Connection, filename: str, sha: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO auth_db._migrations (filename, sha256) VALUES (%s, %s)",
            (filename, sha),
        )


def _apply_one(conn: pymysql.Connection, sql: str) -> None:
    """MySQL doesn't honour DDL inside transactions; we just execute the
    file as a multi-statement batch and rely on each ALTER being atomic.

    pymysql with CLIENT.MULTI_STATEMENTS handles `;`-separated batches.
    We have to consume all result sets so the next execute() doesn't get
    "Commands out of sync".
    """
    with conn.cursor() as cur:
        cur.execute(sql)
        # Drain any extra result sets the multi-statement run produced.
        while cur.nextset():
            pass


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--dir", default="db/migrations",
                   help="Path to the migrations directory (default: db/migrations)")
    p.add_argument("--mark-applied", action="store_true",
                   help="Don't execute SQL — just record every file in the "
                        "ledger as already-applied. One-time bootstrap when "
                        "the DB schema was applied by a prior mechanism.")
    args = p.parse_args()

    mig_dir = Path(args.dir)
    if not mig_dir.is_dir():
        print(f"[migrations] FATAL: not a directory: {mig_dir}", file=sys.stderr)
        return 2

    conn = _connect()
    try:
        _ensure_ledger(conn)
        applied = _applied_filenames(conn)

        files = sorted(p for p in mig_dir.glob("*.sql") if p.is_file())
        if not files:
            print(f"[migrations] no .sql files found in {mig_dir}")
            return 0

        applied_count = 0
        skipped_count = 0
        for f in files:
            content = f.read_text(encoding="utf-8")
            sha = hashlib.sha256(content.encode("utf-8")).hexdigest()
            prev_sha = applied.get(f.name)
            if prev_sha is not None:
                if prev_sha != sha:
                    print(f"[migrations] WARNING: {f.name} content changed since last apply "
                          f"(was {prev_sha[:8]}, now {sha[:8]}). NOT re-applying.")
                skipped_count += 1
                continue

            if args.mark_applied:
                print(f"[migrations] marking {f.name} as already-applied (no SQL run)")
                _record(conn, f.name, sha)
                applied_count += 1
                continue

            print(f"[migrations] applying {f.name} (sha {sha[:8]})...")
            try:
                _apply_one(conn, content)
                _record(conn, f.name, sha)
                applied_count += 1
            except Exception as e:
                print(f"[migrations] FAILED applying {f.name}: {e}", file=sys.stderr)
                return 1

        verb = "marked" if args.mark_applied else "applied"
        print(f"[migrations] done — {verb} {applied_count}, skipped {skipped_count}")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
