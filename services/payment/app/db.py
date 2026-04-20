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
        charset="utf8mb4",
        autocommit=False,
        cursorclass=pymysql.cursors.DictCursor,
    )
    conn = pymysql.connect(**_config, database="payment_db")
    conn.close()
    print("Payment DB connected")


def get_db(db_name: str = "payment_db"):
    return pymysql.connect(**_config, database=db_name)
