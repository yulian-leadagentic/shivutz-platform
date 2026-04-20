"""SystemSettings service — reads/writes system_settings table in payment_db."""
import json
from typing import Any
from app.db import get_db


def get_setting(key: str, default: Any = None) -> Any:
    """Return typed value for setting_key."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT setting_value, value_type FROM system_settings WHERE setting_key=%s",
            (key,)
        )
        row = cur.fetchone()
        if not row:
            if default is not None:
                return default
            raise KeyError(f"Setting '{key}' not found")
        return _coerce(row["setting_value"], row["value_type"])
    finally:
        conn.close()


def get_all_settings() -> dict:
    """Return all settings as {key: {value, value_type, description, updated_at}}."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT setting_key, setting_value, value_type, description, updated_at "
            "FROM system_settings ORDER BY setting_key"
        )
        rows = cur.fetchall()
        return {
            r["setting_key"]: {
                "value":        _coerce(r["setting_value"], r["value_type"]),
                "value_type":   r["value_type"],
                "description":  r["description"],
                "updated_at":   r["updated_at"].isoformat() if r["updated_at"] else None,
            }
            for r in rows
        }
    finally:
        conn.close()


def set_setting(key: str, value: Any, user_id: str = "system") -> None:
    """Upsert a setting value (key must already exist)."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT value_type FROM system_settings WHERE setting_key=%s", (key,)
        )
        row = cur.fetchone()
        if not row:
            raise KeyError(f"Setting '{key}' does not exist")
        str_value = _to_str(value, row["value_type"])
        cur.execute(
            "UPDATE system_settings SET setting_value=%s, updated_by_user_id=%s WHERE setting_key=%s",
            (str_value, user_id, key)
        )
        conn.commit()
    finally:
        conn.close()


def _coerce(raw: str, value_type: str) -> Any:
    if value_type == "number":
        return float(raw)
    if value_type == "boolean":
        return raw.lower() in ("true", "1", "yes")
    if value_type == "json":
        return json.loads(raw)
    return raw


def _to_str(value: Any, value_type: str) -> str:
    if value_type == "json":
        return json.dumps(value)
    return str(value)
