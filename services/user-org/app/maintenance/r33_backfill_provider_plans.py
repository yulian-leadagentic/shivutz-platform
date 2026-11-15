"""R33 B.5 · put every provider listing on a plan, so nothing disappears.

From U7 until R33 a service provider published without a plan: its
listings were written with subscription_id NULL. R33 B.1 makes a plan
in the category a condition for publishing. This script brings the
listings that already exist in line with that rule, without touching
what the public sees.

For every (provider, category) that has active listings:

  * the provider already holds an active plan in the category
        -> its listings that are not on a live plan are linked to it
  * it holds none
        -> one promo plan is created in that category: the cheapest
           active paid tier, promo_note 'r33_backfill', running until
           the launch promo ends, nothing charged. The listings are
           linked to it.

Nothing is deleted, paused or hidden. A provider with more listings
than the tier has slots keeps all of them; it simply cannot add another
until it frees a slot or moves to a larger plan.

Three cases are reported and left alone, because the script has no
honest plan to give:
  * the category has no active paid tier   (an admin adds one, re-run)
  * the launch promo is not running        (there is no promo end date
                                            to run the plan until)
  * the category is one a provider cannot publish in (housing)

Usage, inside the user-org container:

    python3 -m app.maintenance.r33_backfill_provider_plans            # dry run
    python3 -m app.maintenance.r33_backfill_provider_plans --apply    # write

The dry run prints exactly what --apply would do. Re-running after an
apply finds nothing left to do.
"""
import asyncio
import sys
from collections import Counter
from typing import Optional

from app.db import get_db, init_db
from app.services.provider_plans import (
    PROVIDER_BLOCKED_CATEGORIES, insert_promo_plan, launch_promo_end,
)

BACKFILL_NOTE = "r33_backfill"

# A listing is "on a live plan" when its subscription is an active,
# unexpired plan of the same provider in the same category.
_NOT_ON_LIVE_PLAN = """
    NOT EXISTS (
        SELECT 1 FROM marketplace_subscriptions s
         WHERE s.id = ml.subscription_id
           AND s.advertiser_entity_type = 'service_provider'
           AND s.advertiser_entity_id   = ml.advertiser_entity_id
           AND s.category_code          = ml.category
           AND s.status = 'active' AND s.expires_at > NOW()
    )"""


def plan(cur) -> tuple[list[dict], Optional[object]]:
    """Read-only. Returns (actions, promo_end). One action per
    (provider, category) that has an active listing off a live plan."""
    promo_end = launch_promo_end(cur)
    cur.execute(
        f"""SELECT ml.advertiser_entity_id AS provider_id, ml.category,
                   COUNT(*) AS to_link,
                   SUM(ml.subscription_id IS NULL) AS unlinked
              FROM marketplace_listings ml
             WHERE ml.advertiser_entity_type = 'service_provider'
               AND ml.status = 'active' AND ml.deleted_at IS NULL
               AND {_NOT_ON_LIVE_PLAN}
             GROUP BY ml.advertiser_entity_id, ml.category
             ORDER BY ml.category, ml.advertiser_entity_id"""
    )
    groups = cur.fetchall()

    actions = []
    for g in groups:
        action = {
            "provider_id": g["provider_id"], "category": g["category"],
            "to_link": int(g["to_link"]), "unlinked": int(g["unlinked"] or 0),
            "tier": None, "plan_id": None, "slot_count": None, "active_listings": None,
        }
        cur.execute(
            """SELECT COUNT(*) AS n FROM marketplace_listings
                WHERE advertiser_entity_type = 'service_provider'
                  AND advertiser_entity_id = %s AND category = %s
                  AND status = 'active' AND deleted_at IS NULL""",
            (g["provider_id"], g["category"]),
        )
        action["active_listings"] = int(cur.fetchone()["n"])

        cur.execute(
            """SELECT id, slot_count FROM marketplace_subscriptions
                WHERE advertiser_entity_type = 'service_provider'
                  AND advertiser_entity_id = %s AND category_code = %s
                  AND status = 'active' AND expires_at > NOW()
                ORDER BY expires_at DESC LIMIT 1""",
            (g["provider_id"], g["category"]),
        )
        existing = cur.fetchone()
        if existing:
            action.update(kind="link", plan_id=existing["id"], slot_count=int(existing["slot_count"]))
        elif g["category"] in PROVIDER_BLOCKED_CATEGORIES:
            action.update(kind="blocked_category")
        else:
            cur.execute(
                """SELECT id, category_code, name_he, slot_count, duration_days, price_nis
                     FROM marketplace_subscription_tiers
                    WHERE category_code = %s AND is_active = TRUE AND price_nis > 0
                    ORDER BY price_nis ASC, sort_order ASC, id ASC LIMIT 1""",
                (g["category"],),
            )
            tier = cur.fetchone()
            if not tier:
                action.update(kind="no_tier")
            elif not promo_end:
                action.update(kind="no_promo", tier=tier, slot_count=int(tier["slot_count"]))
            else:
                action.update(kind="create", tier=tier, slot_count=int(tier["slot_count"]))
        actions.append(action)
    return actions, promo_end


def apply(cur, actions: list[dict], promo_end) -> int:
    """Write what `plan` decided. Returns how many listings were linked.
    The caller commits."""
    linked = 0
    for a in actions:
        if a["kind"] == "create":
            a["plan_id"] = insert_promo_plan(cur, a["provider_id"], a["tier"], promo_end, BACKFILL_NOTE)
        if a["kind"] not in ("create", "link"):
            continue
        # The same predicate `plan` counted with, minus the plan this
        # action just linked to, so the count and the write agree.
        cur.execute(
            f"""UPDATE marketplace_listings ml
                   SET ml.subscription_id = %s
                 WHERE ml.advertiser_entity_type = 'service_provider'
                   AND ml.advertiser_entity_id = %s AND ml.category = %s
                   AND ml.status = 'active' AND ml.deleted_at IS NULL
                   AND {_NOT_ON_LIVE_PLAN}""",
            (a["plan_id"], a["provider_id"], a["category"]),
        )
        linked += cur.rowcount
    return linked


def unlinked_active_provider_listings(cur) -> int:
    cur.execute(
        """SELECT COUNT(*) AS n FROM marketplace_listings
            WHERE advertiser_entity_type = 'service_provider'
              AND status = 'active' AND deleted_at IS NULL
              AND subscription_id IS NULL"""
    )
    return int(cur.fetchone()["n"])


def report(actions: list[dict], promo_end, out=print) -> None:
    out(f"launch promo ends: {promo_end.strftime('%Y-%m-%d') if promo_end else 'no promo running'}")
    if not actions:
        out("nothing to do: every active provider listing is already on a live plan")
        return
    by_cat: dict[str, Counter] = {}
    for a in actions:
        c = by_cat.setdefault(a["category"], Counter())
        c[f"providers_{a['kind']}"] += 1
        c[f"listings_{a['kind']}"] += a["to_link"]
    labels = {
        "create":           "new promo plan",
        "link":             "link to the plan it already has",
        "no_tier":          "LEFT ALONE, no active paid tier in the category",
        "no_promo":         "LEFT ALONE, no launch promo running",
        "blocked_category": "LEFT ALONE, a provider cannot publish in this category",
    }
    out("per category:")
    for category in sorted(by_cat):
        for kind, label in labels.items():
            n = by_cat[category][f"providers_{kind}"]
            if n:
                out(f"  {category:<14} {label}: {n} provider(s), {by_cat[category][f'listings_{kind}']} listing(s)")
    out("per provider:")
    for a in actions:
        tier = a["tier"]
        detail = f"tier {tier['name_he']} ({tier['slot_count']} slots, sticker {tier['price_nis']})" if tier else ""
        over = ""
        if a["slot_count"] is not None and a["active_listings"] > a["slot_count"]:
            over = f" · OVER QUOTA: {a['active_listings']} active listings on {a['slot_count']} slots, all kept"
        out(f"  {a['provider_id']}  {a['category']:<14} {a['kind']:<17} listings {a['to_link']}"
            f" (never linked {a['unlinked']})  {detail}{over}")


def main(argv: list[str]) -> int:
    do_apply = "--apply" in argv
    asyncio.run(init_db())
    conn = get_db()
    try:
        cur = conn.cursor()
        print("unlinked active provider listings before:", unlinked_active_provider_listings(cur))
        actions, promo_end = plan(cur)
        report(actions, promo_end)
        if not do_apply:
            print("DRY RUN: nothing was written. Re-run with --apply to write.")
            return 0
        linked = apply(cur, actions, promo_end)
        created = sum(1 for a in actions if a["kind"] == "create")
        conn.commit()
        print(f"APPLIED: {created} plan(s) created, {linked} listing(s) linked")
        print("unlinked active provider listings after:", unlinked_active_provider_listings(cur))
        left, _ = plan(cur)
        print("still off a live plan:", sum(a["to_link"] for a in left), "listing(s) in",
              len(left), "group(s)" + (" (the LEFT ALONE cases above)" if left else ""))
        return 0
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
