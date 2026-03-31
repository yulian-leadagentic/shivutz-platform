import os
import mysql.connector.pooling

_pools = {}

async def init_db():
    global _pools
    base = dict(
        host=os.getenv("MYSQL_HOST", "mysql"),
        port=int(os.getenv("MYSQL_PORT", 3306)),
        user="root",
        password=os.getenv("MYSQL_ROOT_PASSWORD"),
        charset="utf8mb4",
    )
    for name in ["org_db", "worker_db", "job_db", "deal_db"]:
        _pools[name] = mysql.connector.pooling.MySQLConnectionPool(
            pool_name=f"admin_{name}", pool_size=5, database=name, **base
        )
    print("Admin DB pools connected")

def get_db(schema: str):
    return _pools[schema].get_connection()
