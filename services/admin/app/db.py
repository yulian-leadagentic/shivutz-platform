import os
import pymysql
import pymysql.cursors

_base_config = {}

async def init_db():
    global _base_config
    _base_config = dict(
        host=os.getenv("MYSQL_HOST", "mysql"),
        port=int(os.getenv("MYSQL_PORT", 3306)),
        user="root",
        password=os.getenv("MYSQL_ROOT_PASSWORD"),
        charset="utf8mb4",
        autocommit=False,
        cursorclass=pymysql.cursors.DictCursor,
    )
    # Verify connectivity
    for db in ["org_db", "worker_db", "job_db", "deal_db", "payment_db", "auth_db"]:
        conn = pymysql.connect(**_base_config, database=db)
        conn.close()
    print("Admin DB pools connected")

def get_db(schema: str):
    return pymysql.connect(**_base_config, database=schema)
