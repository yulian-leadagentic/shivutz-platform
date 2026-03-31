import uuid, json
from app.db import get_db


def log(entity_type: str, entity_id: str, action: str, performed_by: str,
        old_value: dict = None, new_value: dict = None, ip_address: str = None):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO audit_log (id, entity_type, entity_id, action, performed_by, old_value, new_value, ip_address)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (str(uuid.uuid4()), entity_type, entity_id, action, performed_by,
             json.dumps(old_value) if old_value else None,
             json.dumps(new_value) if new_value else None,
             ip_address)
        )
        conn.commit()
    finally:
        conn.close()
