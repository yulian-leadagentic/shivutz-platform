import os
import mysql.connector.pooling

_pool = None

async def init_db():
    global _pool
    _pool = mysql.connector.pooling.MySQLConnectionPool(
        pool_name="deal",
        pool_size=10,
        host=os.getenv("MYSQL_HOST", "mysql"),
        port=int(os.getenv("MYSQL_PORT", 3306)),
        user="root",
        password=os.getenv("MYSQL_ROOT_PASSWORD"),
        database=os.getenv("DB_NAME", "deal_db"),
        charset="utf8mb4",
    )
    print("Deal DB connected")

def get_db():
    return _pool.get_connection()
