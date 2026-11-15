"""R33 B · a service provider's plan in a category.

The rule (Yulian, 15.11): a provider can publish in a category only
while it has an active plan in that category. Every category has its
own price. During the launch promo the price paid may be 0, but the
listing is still linked to an active plan.

A plan is a `marketplace_subscriptions` row. This module holds the
pieces three callers share, so "a promo row exactly like registration
makes" is one piece of code and not three copies:

  * provider registration            routes/providers.py
  * a provider adding a category     routes/marketplace_subscriptions.py
  * the R33 backfill                 maintenance/r33_backfill_provider_plans.py
"""
import uuid
from datetime import datetime
from typing import Optional

# Categories a provider can never publish in, so never buy a plan in:
# housing belongs to corporations (it rides their licence), worker ads
# are not marketplace listings at all.
PROVIDER_BLOCKED_CATEGORIES = frozenset({"housing", "worker"})

LAUNCH_PROMO_NOTE = "launch_free_promo"


def launch_promo_end(cur) -> Optional[datetime]:
    """The end of the launch promo, or None when no promo applies.

    Read from site_settings.launch_promo_end (YYYY-MM-DD). A missing or
    malformed value, or a date that has passed, means no promo: this
    fails closed on the "we are giving the service away" side.
    """
    cur.execute(
        "SELECT setting_val FROM site_settings WHERE setting_key='launch_promo_end' LIMIT 1"
    )
    row = cur.fetchone()
    if not row or not row.get("setting_val"):
        return None
    try:
        end = datetime.strptime(row["setting_val"], "%Y-%m-%d")
    except (ValueError, TypeError):
        return None
    return end if end > datetime.utcnow() else None


def insert_promo_plan(
    cur,
    provider_id: str,
    tier: dict,
    promo_end: datetime,
    promo_note: str = LAUNCH_PROMO_NOTE,
) -> str:
    """Write an active promo plan for `provider_id` on `tier` and return
    its id. Nothing is charged: `price_nis` keeps the tier's sticker
    price as a snapshot of what the plan was worth, `promo_note` says
    why nothing was paid, and the plan runs until `promo_end` whatever
    the tier's own duration is.

    `tier` needs id, category_code, slot_count, duration_days, price_nis.
    The caller commits.
    """
    sub_id = str(uuid.uuid4())
    cur.execute(
        """INSERT INTO marketplace_subscriptions
               (id, advertiser_entity_type, advertiser_entity_id,
                category_code, tier_id, slot_count, duration_days,
                price_nis, promo_note,
                expires_at, auto_renew, status, cardcom_token_ref)
           VALUES (%s, 'service_provider', %s, %s, %s, %s, %s,
                   %s, %s,
                   %s, TRUE, 'active', NULL)""",
        (
            sub_id, provider_id,
            tier["category_code"], tier["id"], tier["slot_count"], tier["duration_days"],
            tier["price_nis"], promo_note,
            promo_end,
        ),
    )
    return sub_id


def plan_at_registration(cur, provider_id: str, tier: dict, promo_end: Optional[datetime]) -> Optional[str]:
    """The plan a provider leaves registration with: the id of its promo
    plan while the launch promo runs, None once it is over.

    R37 4.1.3 (Yulian, 15.11): no plan activates without a successful
    charge. From R10 until now, a registration after the promo wrote an
    active plan at the tier's full price and charged nothing, for want
    of any charging to do. It now writes no plan: the provider exists,
    is sent to "מנוי ותשלום", and gets its plan the way every later plan
    is got, through the purchase endpoint. That endpoint refuses while
    there is no online payment, so until Cardcom is wired in a provider
    who registers after the promo cannot publish. That is the rule
    working, not a gap in it.

    The caller commits."""
    if promo_end is None:
        return None
    return insert_promo_plan(cur, provider_id, tier, promo_end)


def is_paid_tier(tier: dict) -> bool:
    """A tier a provider may pick: active, and with a real price. A
    price of 0 marks an admin-only override, which no picker offers."""
    return bool(tier.get("is_active")) and bool(tier.get("price_nis")) and float(tier["price_nis"]) > 0
