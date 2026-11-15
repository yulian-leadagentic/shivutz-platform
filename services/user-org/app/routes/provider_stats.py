"""R34 5c · the numbers a service provider sees about its own listings.

One route:
    GET /organizations/providers/me/stats?days=30   (or days=7)

What it answers, for the last 30 or 7 days:
  * per listing: impressions (the card was on screen), opens (the detail
    panel was opened), reveals (someone asked for the contact details)
  * the same three as totals, and day by day for one trend line
  * how many searches there were in the provider's categories and
    regions

Where the numbers come from:
  * impressions and opens  · promo_events, target_type
    'marketplace_listing' (written by routes/events.py)
  * reveals                · marketplace_reveals, the table the reveal
    endpoint has written since R15. It holds one row per (viewer,
    listing), so a reveal here means a distinct viewer, dated by the
    first time they asked. Reveals are read from there and are not
    events, which is what keeps them from being counted twice.
  * searches               · search_log (services/search_log.py)

Privacy and authorization, the two rules this file exists to keep:
  1. The provider is whoever the gateway says the caller is
     (x-entity-type / x-entity-id, projected from the JWT). No path
     segment and no query parameter names a provider, so there is no
     request a caller could write that asks for somebody else. Every
     query below is bound to that id.
  2. Only counts leave this endpoint. No viewer id, no session id, no
     search text. Listing events are stored without an actor in the
     first place; reveal rows do carry the viewer, and are only ever
     COUNTed here.

A day is a calendar day in Israel (Asia/Jerusalem), whatever clock the
database keeps. The database runs in UTC, and R34 counted days on its
clock: "today" turned over at 02:00 or 03:00 local time and a view at
01:30 was filed under yesterday (R34 finding 6). Now the window is
whole local days ending today. Rows are read grouped by UTC hour and
put into local days here, so the summer-time change inside a window is
handled by the time zone database and not by a fixed offset. Totals and
the per-day series are built from the same rows, so they still add up
exactly. A direct check is
`SELECT COUNT(*) ... WHERE at >= <local midnight of the first day, as UTC>`.

No joins across tables: marketplace_listings is utf8mb4_unicode_ci and
the three tables read here were created under the server default, so a
join on the id columns is an illegal mix of collations. The listing ids
are read once and bound as parameters instead.
"""
import json
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo
from typing import Optional

from fastapi import APIRouter, HTTPException, Header

from app.db import get_db

router = APIRouter()

# The dashboard offers exactly these two windows.
_ALLOWED_DAYS = (30, 7)

# Searches made by providers and admins are not demand. They are left
# out so that a provider checking how its own listing ranks does not
# read its own curiosity back as customer interest.
_NON_CUSTOMER_VIEWERS = ("service_provider", "admin")

# `national` is the regions catalogue's "anywhere" code. On a listing it
# means the same as no region; on a search it means the user asked for
# the whole country.
_ANYWHERE = "national"


def _regions_of(listing: dict) -> list:
    """The region codes a listing serves. `regions` (a JSON array, text
    as it comes from MySQL) is the full answer where the listing has
    one; otherwise its single `region`. Empty means "not stated", which
    has always counted as nationwide."""
    raw = listing.get("regions")
    if isinstance(raw, (str, bytes, bytearray)):
        try:
            raw = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError):
            raw = None
    if isinstance(raw, list) and raw:
        return [r for r in raw if isinstance(r, str)]
    return [listing["region"]] if listing.get("region") else []


_LOCAL = ZoneInfo("Asia/Jerusalem")
_HOUR_FORMAT = "%Y-%m-%d %H:00:00"


def local_window(now_utc: datetime, days: int) -> tuple[date, date, datetime]:
    """The window as (first local day, today's local day, the UTC
    instant the first day begins)."""
    today = now_utc.replace(tzinfo=timezone.utc).astimezone(_LOCAL).date()
    since = today - timedelta(days=days - 1)
    since_utc = (
        datetime.combine(since, time.min, tzinfo=_LOCAL)
        .astimezone(timezone.utc).replace(tzinfo=None)
    )
    return since, today, since_utc


def by_local_day(rows: list[dict], id_key: str, metrics: tuple) -> list[dict]:
    """Rows grouped by UTC hour (`hour`, 'YYYY-MM-DD HH:00:00') folded
    into rows per local day (`day`), the shape build_stats reads."""
    folded: dict = {}
    for row in rows:
        hour = row["hour"]
        if isinstance(hour, str):
            hour = datetime.strptime(hour, _HOUR_FORMAT)
        day = hour.replace(tzinfo=timezone.utc).astimezone(_LOCAL).date()
        slot = folded.setdefault((row[id_key], day), dict.fromkeys(metrics, 0))
        for metric in metrics:
            slot[metric] += int(row.get(metric) or 0)
    return [{id_key: key, "day": day, **counts} for (key, day), counts in folded.items()]


def demand_scope(listings: list[dict], primary_category: Optional[str]) -> tuple[dict, str]:
    """Which searches count as "in your categories and regions".

    Returns `(scope, source)`. `scope` maps a category code to either
    None (nationwide) or the set of region codes the provider serves in
    that category. It is built from the provider's ACTIVE listings: a
    listing with no region is nationwide, and one nationwide listing
    makes the whole category nationwide.

    A provider with no active listing still has a trade, the category
    it registered under. That is used, nationwide, so the dashboard can
    show demand before the first listing is published. `source` says
    which of the two happened ('listings', 'primary_category', 'none').
    """
    scope: dict[str, Optional[set]] = {}
    for listing in listings:
        if listing.get("status") != "active":
            continue
        category = listing.get("category")
        if not category:
            continue
        # R34 4c · a listing can serve several regions. `regions` is the
        # full answer where it exists; the single `region` otherwise.
        served = _regions_of(listing)
        if not served or _ANYWHERE in served:
            scope[category] = None
        elif category not in scope:
            scope[category] = set(served)
        elif scope[category] is not None:
            scope[category].update(served)
    if scope:
        return scope, "listings"
    if primary_category:
        return {primary_category: None}, "primary_category"
    return {}, "none"


def demand_where(scope: dict) -> tuple[str, list]:
    """SQL predicate + params selecting the search_log rows inside
    `scope`. Mirrors the soft region filter the search itself applies
    to listings: a search with no region, or for the whole country, is
    demand everywhere; a search for one region is demand for whoever
    serves that region or serves nationwide."""
    parts: list[str] = []
    params: list = []
    for category in sorted(scope):
        regions = scope[category]
        # JSON_CONTAINS wants its needle as JSON text, hence the dumps.
        if regions is None:
            parts.append("JSON_CONTAINS(categories, %s)")
            params.append(json.dumps(category))
        else:
            placeholders = ",".join(["%s"] * len(regions))
            parts.append(
                "(JSON_CONTAINS(categories, %s) AND "
                f"(region IS NULL OR region = %s OR region IN ({placeholders})))"
            )
            params.append(json.dumps(category))
            params.append(_ANYWHERE)
            params.extend(sorted(regions))
    return "(" + " OR ".join(parts) + ")", params


def build_stats(
    listings: list[dict],
    event_rows: list[dict],
    reveal_rows: list[dict],
    since: date,
    days: int,
) -> dict:
    """Fold the grouped rows into per-listing counts, totals and a
    zero-filled daily series. Pure, so the arithmetic is testable
    without a database.

    `event_rows`  · {target_id, day, impressions, opens}
    `reveal_rows` · {listing_id, day, reveals}
    Rows for a listing or a day outside the request are ignored rather
    than trusted: the totals are by construction the sum of the rows
    the provider can see.
    """
    per_listing = {
        l["id"]: {"impressions": 0, "opens": 0, "reveals": 0} for l in listings
    }
    per_day = {
        since + timedelta(days=i): {"impressions": 0, "opens": 0, "reveals": 0}
        for i in range(days)
    }

    def add(listing_id, day, metric, value):
        n = int(value or 0)
        if n <= 0 or listing_id not in per_listing or day not in per_day:
            return
        per_listing[listing_id][metric] += n
        per_day[day][metric] += n

    for row in event_rows:
        add(row["target_id"], row["day"], "impressions", row.get("impressions"))
        add(row["target_id"], row["day"], "opens",       row.get("opens"))
    for row in reveal_rows:
        add(row["listing_id"], row["day"], "reveals", row.get("reveals"))

    totals = {"impressions": 0, "opens": 0, "reveals": 0}
    for counts in per_listing.values():
        for metric in totals:
            totals[metric] += counts[metric]

    return {
        "totals": totals,
        "per_listing": per_listing,
        "series": [
            {"day": day.isoformat(), **per_day[day]} for day in sorted(per_day)
        ],
    }


@router.get("/me/stats")
def provider_stats(
    days:          int = 30,
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    """Aggregates for the calling provider. 403 for any caller that is
    not acting as a service provider, 404 when the provider row is
    gone, 400 for a window other than 30 or 7."""
    if x_entity_type != "service_provider" or not x_entity_id:
        raise HTTPException(status_code=403, detail="provider_only")
    if days not in _ALLOWED_DAYS:
        raise HTTPException(status_code=400, detail={"code": "invalid_days"})

    conn = get_db()
    try:
        cur = conn.cursor()
        # The database's clock rides along, in UTC, with how far this
        # session's own time is from UTC (0 on a UTC server). Every
        # timestamp below is compared and bucketed in UTC through that
        # offset, so the answer does not depend on the session's zone.
        cur.execute(
            """SELECT primary_category,
                      UTC_TIMESTAMP() AS now_utc,
                      TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) AS tz_offset_s
                 FROM service_providers
                WHERE id = %s AND deleted_at IS NULL
                LIMIT 1""",
            (x_entity_id,),
        )
        provider = cur.fetchone()
        if not provider:
            raise HTTPException(status_code=404, detail="provider_not_found")
        offset_s = int(provider.get("tz_offset_s") or 0)
        since, today, since_utc = local_window(provider["now_utc"], days)
        # The window's start as this session writes timestamps.
        since_at = since_utc + timedelta(seconds=offset_s)

        cur.execute(
            """SELECT id, title, category, region, regions, status
                 FROM marketplace_listings
                WHERE advertiser_entity_type = 'service_provider'
                  AND advertiser_entity_id   = %s
                  AND deleted_at IS NULL
                ORDER BY created_at DESC""",
            (x_entity_id,),
        )
        listings = cur.fetchall()
        listing_ids = [l["id"] for l in listings]

        event_rows: list = []
        reveal_rows: list = []
        if listing_ids:
            placeholders = ",".join(["%s"] * len(listing_ids))
            cur.execute(
                f"""SELECT target_id,
                           DATE_FORMAT(at - INTERVAL %s SECOND, '%%Y-%%m-%%d %%H:00:00') AS hour,
                           SUM(event_type='listing_impression') AS impressions,
                           SUM(event_type='listing_open')       AS opens
                      FROM promo_events
                     WHERE target_type = 'marketplace_listing'
                       AND target_id IN ({placeholders})
                       AND event_type IN ('listing_impression', 'listing_open')
                       AND at >= %s
                     GROUP BY target_id, hour""",
                (offset_s, *listing_ids, since_at),
            )
            event_rows = by_local_day(cur.fetchall(), "target_id", ("impressions", "opens"))

            # The provider's own row is left out: revealing your own
            # listing is not a lead.
            cur.execute(
                f"""SELECT listing_id,
                           DATE_FORMAT(revealed_at - INTERVAL %s SECOND, '%%Y-%%m-%%d %%H:00:00') AS hour,
                           COUNT(*)          AS reveals
                      FROM marketplace_reveals
                     WHERE listing_id IN ({placeholders})
                       AND revealed_at >= %s
                       AND NOT (viewer_entity_type = 'service_provider'
                                AND viewer_entity_id = %s)
                     GROUP BY listing_id, hour""",
                (offset_s, *listing_ids, since_at, x_entity_id),
            )
            reveal_rows = by_local_day(cur.fetchall(), "listing_id", ("reveals",))

        scope, scope_source = demand_scope(listings, provider.get("primary_category"))
        searches = 0
        if scope:
            scope_sql, scope_params = demand_where(scope)
            viewers = ",".join(["%s"] * len(_NON_CUSTOMER_VIEWERS))
            cur.execute(
                f"""SELECT COUNT(*) AS n
                      FROM search_log
                     WHERE searched_at >= %s
                       AND (viewer_type IS NULL OR viewer_type NOT IN ({viewers}))
                       AND {scope_sql}""",
                (since_at, *_NON_CUSTOMER_VIEWERS, *scope_params),
            )
            searches = int(cur.fetchone()["n"] or 0)

        cur.execute("SELECT code, name_he FROM marketplace_categories")
        category_names = {r["code"]: r["name_he"] for r in cur.fetchall()}
    finally:
        conn.close()

    stats = build_stats(listings, event_rows, reveal_rows, since, days)

    return {
        "days":  days,
        "since": since.isoformat(),
        "until": today.isoformat(),
        "totals": {**stats["totals"], "searches": searches},
        "listings": [
            {
                "id":            l["id"],
                "title":         l["title"],
                "category":      l["category"],
                "category_name": category_names.get(l["category"]) or l["category"],
                "region":        l["region"],
                "status":        l["status"],
                **stats["per_listing"][l["id"]],
            }
            for l in listings
        ],
        "series": stats["series"],
        # What "searches" was counted over, so the dashboard can say so
        # instead of leaving the provider to guess what the number means.
        "search_scope": {
            "source": scope_source,
            "categories": [
                {
                    "code":    code,
                    "name":    category_names.get(code) or code,
                    "regions": sorted(scope[code]) if scope[code] is not None else None,
                }
                for code in sorted(scope)
            ],
        },
    }
