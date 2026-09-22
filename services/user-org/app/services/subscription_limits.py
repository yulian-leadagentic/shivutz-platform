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
    # R10 §6 · service_provider — one tier for now. Mirrors migration
    # 089 exactly so a fresh DB (row missing) still sees the same
    # numbers. max_users=None + extra_user_price_nis=50 = R4's seat
    # gate returns 402 seat_upgrade_required once in_use exceeds 5;
    # the same purchase flow the contractor uses then applies, at
    # the ₪50 price Yulian locked in decisions-doc §2.
    "service_provider": {
        "basic":    {"max_users": None, "included_users": 5, "extra_user_price_nis": 50,   "reveals_per_month": None, "active_ads": None, "can_boost": False},
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


def all_tier_limits(entity_type: str) -> list[dict[str, Optional[int]]]:
    """R26 §1b · list every seeded tier for one entity_type in ONE query.

    Same projection as `tier_limits` above — allow-listed columns, no
    SELECT *, cross-schema on the same connection. Returns them ordered
    the way the billing screen renders (basic → advanced → pro …).

    Why this exists: /billing renders three plan cards and needs the
    catalog (price + seats + reveals) for each tier so the customer sees
    what an upgrade costs. Calling `tier_limits(tier, entity_type)` three
    times would round-trip three times and duplicate the fallback logic
    per row; this batches. The projection is duplicated deliberately
    from `tier_limits` — a shared helper would tie the two contracts
    together and I want them to move independently later (per-tier vs
    catalog).

    Contract on missing rows: the DB is the source of truth. If a
    tier isn't seeded, it's simply absent from the list — this
    function does NOT synthesize from _FALLBACK. The billing UI then
    renders "מחיר לא זמין" + disabled button for tiers with
    `monthly_price_nis === null`, per R26 §1c. That way a missing
    plan is visibly missing instead of quietly filled with a
    made-up number that could contradict what the customer sees at
    checkout.
    """
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT tier, max_users, included_users, extra_user_price_nis,
                      max_reveals_per_month, max_active_ads,
                      max_ad_lifetime_days, monthly_price_nis, can_boost
                 FROM payment_db.subscription_plans
                WHERE entity_type=%s
                ORDER BY FIELD(tier, 'basic', 'advanced', 'pro'), tier""",
            (entity_type,),
        )
        rows = cur.fetchall()
    finally:
        conn.close()
    return [
        {
            "tier":                 r["tier"],
            "max_users":            r["max_users"],
            "included_users":       r["included_users"],
            "extra_user_price_nis": r["extra_user_price_nis"],
            "reveals_per_month":    r["max_reveals_per_month"],
            "active_ads":           r["max_active_ads"],
            "max_ad_lifetime_days": r["max_ad_lifetime_days"],
            "monthly_price_nis":    r["monthly_price_nis"],
            "can_boost":            bool(r["can_boost"]),
        }
        for r in rows
    ]


def effective_seats(entity_id: str, entity_type: str) -> dict:
    """R4 · single source of truth for how many seats an entity has.

    Three inputs, three outputs, plus the runtime totals:
        included  — from subscription_plans (admin-editable at
                    /admin/subscription-plans)
        paid      — from subscriptions.extra_seats_paid (customer
                    bought via /subscriptions/seats/…; billed in the
                    renewal batch)
        granted   — from subscriptions.extra_seats_granted (admin
                    granted at /admin/subscriptions/…; NEVER billed)
        total     — included + paid + granted
        in_use    — active memberships on the entity (accepted or
                    pending invite; matches the count contractors.py
                    and corporations.py were computing inline)

    R4 §2 rule: every seat gate reads this one function. Do NOT
    re-compute the sum at a call site — inline math is exactly the
    pattern that produced seven L4 bugs.

    Contract when payment_db is unreachable: falls back to the
    subscription_plans row via tier_limits(), assumes paid=0
    granted=0, and marks `stale=True` on the return so the UI can
    surface that the extras count may be behind reality.
    """
    ent = fetch_entitlement(entity_id, entity_type)
    limits = tier_limits(ent["tier"], entity_type)
    included = limits.get("included_users") or 0

    conn = get_db()
    try:
        cur = conn.cursor()
        # subscriptions is on payment_db, memberships on auth_db.
        # Cross-schema read on the same connection — matches the
        # pattern L4 uses for tier_limits above.
        cur.execute(
            """SELECT extra_seats_paid, extra_seats_granted
                 FROM payment_db.subscriptions
                WHERE entity_id=%s AND entity_type=%s
                LIMIT 1""",
            (entity_id, entity_type),
        )
        row = cur.fetchone()
        paid    = int(row["extra_seats_paid"])    if row else 0
        granted = int(row["extra_seats_granted"]) if row else 0
        stale   = row is None

        cur.execute(
            """SELECT COUNT(*) AS n
                 FROM auth_db.entity_memberships
                WHERE entity_type=%s
                  AND entity_id=%s
                  AND (is_active=TRUE OR invitation_accepted_at IS NULL)""",
            (entity_type, entity_id),
        )
        in_use = int(cur.fetchone()["n"])
    finally:
        conn.close()

    return {
        "included": int(included),
        "paid":     paid,
        "granted":  granted,
        "total":    int(included) + paid + granted,
        "in_use":   in_use,
        "tier":     ent["tier"],
        # R4 §2 fallback marker — True when no payment_db row exists
        # yet (fresh trial). Callers should treat this as "extras
        # are best-effort 0" and NOT as an error.
        "stale":    stale,
    }
