import os
import pymysql
import pymysql.cursors

_config = {}

async def init_db():
    global _config
    _config = dict(
        host=os.getenv("MYSQL_HOST", "mysql"),
        port=int(os.getenv("MYSQL_PORT", 3306)),
        user="root",
        password=os.getenv("MYSQL_ROOT_PASSWORD"),
        database=os.getenv("DB_NAME", "org_db"),
        charset="utf8mb4",
        autocommit=False,
        cursorclass=pymysql.cursors.DictCursor,
    )
    conn = pymysql.connect(**_config)
    conn.close()
    print("User-Org DB connected")

def get_db():
    return pymysql.connect(**_config)
