"""Pivot/v2 — per-tier subscription limits sourced from payment_db.subscription_plans.

The plans table is admin-editable at runtime (see
services/admin/app/routes/subscription_plans.py), so limits are read
per request rather than pinned to a Python constant. Falls back to a
sane basic default if the row is missing (guards against a fresh DB
that hasn't been seeded).
"""
import os
from typing import Optional

import httpx

from app.db import get_db

PAYMENT_SVC = os.getenv("PAYMENT_SERVICE_URL", "http://payment:3009")

# Fallback used only if the DB row is missing (fresh install without seed).
_FALLBACK = {
    "basic":    {"max_users": 1, "reveals_per_month": 10,   "active_ads": 3,  "can_boost": False},
    "advanced": {"max_users": 3, "reveals_per_month": 40,   "active_ads": 15, "can_boost": True},
    "pro":      {"max_users": 10, "reveals_per_month": 120, "active_ads": None, "can_boost": True},
}


def fetch_entitlement(entity_id: str, entity_type: str) -> dict:
    """Ask the payment service what tier + status the entity is on."""
    with httpx.Client(timeout=3.0) as client:
        r = client.get(
            f"{PAYMENT_SVC}/payments/subscriptions/check",
            headers={"x-entity-id": entity_id, "x-entity-type": entity_type},
        )
    if r.status_code == 402:
        body = r.json().get("detail", {})
        return {"tier": body.get("tier", "basic"), "status": body.get("status", "expired"), "entitled": False}
    if r.status_code == 200:
        body = r.json()
        return {"tier": body.get("tier", "basic"), "status": body.get("status"), "entitled": True}
    r.raise_for_status()
    return {"tier": "basic", "status": "unknown", "entitled": False}


def tier_limits(tier: str, entity_type: str = "contractor") -> dict[str, Optional[int]]:
    """Read tier limits from payment_db.subscription_plans.

    Returns dict with keys: max_users, reveals_per_month, active_ads,
    can_boost. Values may be None meaning "unlimited". Falls back to
    _FALLBACK if the row is missing.
    """
    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT max_users, max_reveals_per_month, max_active_ads, can_boost
                 FROM subscription_plans
                WHERE entity_type=%s AND tier=%s""",
            (entity_type, tier),
        )
        row = cur.fetchone()
    finally:
        conn.close()
    if not row:
        return _FALLBACK.get(tier, _FALLBACK["basic"])
    return {
        "max_users":         row["max_users"],
        "reveals_per_month": row["max_reveals_per_month"],
        "active_ads":        row["max_active_ads"],
        "can_boost":         bool(row["can_boost"]),
    }
