import os
from typing import Dict

import pymysql
import pymysql.cursors
from dbutils.pooled_db import PooledDB

_base_config: Dict[str, object] = {}
_pools: Dict[str, PooledDB] = {}


def _make_pool(db_name: str) -> PooledDB:
    return PooledDB(
        creator=pymysql,
        mincached=1,
        maxcached=5,
        maxshared=0,             # pymysql connections aren't shared across threads
        maxconnections=10,
        blocking=True,           # briefly wait when saturated rather than erroring
        ping=1,                  # ping on checkout (guards against MySQL "gone away")
        cursorclass=pymysql.cursors.DictCursor,
        database=db_name,
        **_base_config,
    )


def _get_pool(db_name: str) -> PooledDB:
    pool = _pools.get(db_name)
    if pool is None:
        pool = _make_pool(db_name)
        _pools[db_name] = pool
    return pool


async def init_db() -> None:
    global _base_config
    _base_config = dict(
        host=os.getenv("MYSQL_HOST", "mysql"),
        port=int(os.getenv("MYSQL_PORT", 3306)),
        user="root",
        password=os.getenv("MYSQL_ROOT_PASSWORD"),
        charset="utf8mb4",
        autocommit=False,
    )
    # Fail fast at startup if the main DB is unreachable.
    conn = _get_pool("payment_db").connection()
    conn.close()
    print("Payment DB pool initialised (payment_db)")


def get_db(db_name: str = "payment_db"):
    """Return a pooled connection; .close() returns it to the pool."""
    return _get_pool(db_name).connection()
