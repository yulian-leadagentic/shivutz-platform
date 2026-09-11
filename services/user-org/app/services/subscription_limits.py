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

# Fallback used only if the DB row is missing (fresh install without
# seed). L4 §3 mistake 2 — the pre-L4 _FALLBACK was contractor-shaped
# and got applied to corporations too (max_users:1 vs the correct 3),
# which is exactly the kind of "rare path nobody notices" bug the L4
# guardrail called out. Now keyed by (entity_type, tier) so a corp
# hit gets corp shape and a contractor hit gets contractor shape.
# included_users + extra_user_price_nis are the L4 additions; they
# mirror the seeded values in 071_subscription_plans_seats.sql so
# fallback behaviour matches production even when the row is missing.
_FALLBACK = {
    "contractor": {
        "basic":    {"max_users": 10,   "included_users": 5, "extra_user_price_nis": 80,  "reveals_per_month": 10,  "active_ads": 3,  "can_boost": False},
        "advanced": {"max_users": 20,   "included_users": 5, "extra_user_price_nis": 80,  "reveals_per_month": 40,  "active_ads": 15, "can_boost": True},
        "pro":      {"max_users": None, "included_users": 5, "extra_user_price_nis": 80,  "reveals_per_month": 120, "active_ads": None, "can_boost": True},
    },
    "corporation": {
        "basic":    {"max_users": 3,    "included_users": 3,  "extra_user_price_nis": None, "reveals_per_month": None, "active_ads": 3,  "can_boost": False},
        "advanced": {"max_users": 6,    "included_users": 6,  "extra_user_price_nis": None, "reveals_per_month": None, "active_ads": 15, "can_boost": True},
        "pro":      {"max_users": 12,   "included_users": 12, "extra_user_price_nis": None, "reveals_per_month": None, "active_ads": None, "can_boost": True},
    },
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
    # user-org's connection is scoped to org_db; the plans table lives in
    # payment_db. Cross-schema SQL keeps us on a single connection and
    # avoids adding a second pool.
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT max_users, included_users, extra_user_price_nis,
                      max_reveals_per_month, max_active_ads,
                      max_ad_lifetime_days, monthly_price_nis, can_boost
                 FROM payment_db.subscription_plans
                WHERE entity_type=%s AND tier=%s""",
            (entity_type, tier),
        )
        row = cur.fetchone()
    finally:
        conn.close()
    if not row:
        by_type = _FALLBACK.get(entity_type) or _FALLBACK["contractor"]
        fb = by_type.get(tier) or by_type["basic"]
        return {**fb, "max_ad_lifetime_days": None, "monthly_price_nis": None}
    return {
        "max_users":            row["max_users"],
        # L4 — new fields. `included_users` = seats bundled in the base
        # price; `extra_user_price_nis` = ₪/mo per additional seat
        # (NULL means "additional seats not sold on this tier").
        "included_users":       row["included_users"],
        "extra_user_price_nis": row["extra_user_price_nis"],
        "reveals_per_month":    row["max_reveals_per_month"],
        "active_ads":           row["max_active_ads"],
        "max_ad_lifetime_days": row["max_ad_lifetime_days"],
        "monthly_price_nis":    row["monthly_price_nis"],
        "can_boost":            bool(row["can_boost"]),
    }
