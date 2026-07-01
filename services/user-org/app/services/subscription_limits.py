"""Pivot/v2 Phase 5 — per-tier subscription limits.

Enforced in-service (user-org calls into payment for the tier, then
applies these caps locally). Numbers are business-logic defaults; move
into DB seed if they need per-tenant customisation later.

Basic     — modest free-trial-alike tier
Advanced  — mid-market
Pro       — no limits
"""
import os
from typing import Optional

import httpx

PAYMENT_SVC = os.getenv("PAYMENT_SERVICE_URL", "http://payment:3009")

TIER_LIMITS: dict[str, dict[str, Optional[int]]] = {
    "basic":    {"reveals_per_month":  3, "active_ads":  3,  "can_boost": False},
    "advanced": {"reveals_per_month": 20, "active_ads": 15,  "can_boost": True},
    "pro":      {"reveals_per_month": None, "active_ads": None, "can_boost": True},
}


def fetch_entitlement(entity_id: str, entity_type: str) -> dict:
    """Ask the payment service what tier + status the entity is on.

    Returns {"tier": ..., "status": ..., "entitled": bool}. Raises on
    network / 5xx errors; caller decides whether that's fatal.
    """
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
    return {"tier": "basic", "status": "unknown", "entitled": False}  # unreachable


def tier_limits(tier: str) -> dict[str, Optional[int]]:
    return TIER_LIMITS.get(tier, TIER_LIMITS["basic"])
