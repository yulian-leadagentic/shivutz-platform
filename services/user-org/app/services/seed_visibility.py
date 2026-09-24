"""R30 · one flag: seed rows are never served in production.

Why this exists
---------------
`sponsor_ads.advertiser_name` is a PUBLIC field — it renders as the
wordmark when an ad has no logo (page.tsx:2625) and inside the
`aria-label` a screen reader announces (page.tsx:2592, :2619). Staging
carried real Israeli company names on that surface, presented as
advertisers: "איילון חברה לביטוח" is a real, publicly-traded insurer.
On staging that is embarrassing; in production it is using an existing
company's name as a customer that is not a customer.

The fix is NOT deletion and NOT renaming every row. Seed rows hold the
demo surfaces we measure against, and they have to keep working on
staging. So: one environment gate. Seeds stay visible everywhere we
develop, and are invisible in production regardless of what anyone
remembered to clean up.

Five tables carry `is_seed`: contractors, corporations,
marketplace_listings, service_providers, sponsor_ads.

The naming rule (R30, Yulian 24.09)
-----------------------------------
A row's provenance belongs in `is_seed` and in `note` — NEVER in a
field the public can read. The nine "R5 seed · …" / "U7 seed · …"
rows predate this rule and are left alone deliberately: they hold the
staging demo, and this gate already covers them. Anything added from
here gets a plain plausible name and `is_seed = TRUE`; a visitor
should never see the word "seed", and neither should a screen reader.

Enforcement, not trust
----------------------
scripts/check-no-seed-rows-in-prod.py verifies that a live environment
serves zero seed rows. It is a BLOCKING launch-list item — checked by
a script, not by eye, because "we cleaned it up" is exactly the kind
of claim that is true right up until someone adds one more row.
"""
from __future__ import annotations

import os


def _environment() -> str:
    # Same var the L8 §1 logging config already reads, so there is no
    # second environment signal to keep in sync.
    return (os.getenv("ENVIRONMENT") or "").strip().lower()


def hide_seed_rows() -> bool:
    """True when this environment must not serve seed rows.

    Production hides them. Development and staging show them — that is
    where the demo lives and where every measurement in R29/R30 was
    taken.

    `HIDE_SEED_ROWS` forces the production behaviour anywhere, so the
    gate can be exercised on staging without a deploy when someone
    wants to see the site as a real visitor will.
    """
    override = (os.getenv("HIDE_SEED_ROWS") or "").strip().lower()
    if override in ("1", "true", "yes"):
        return True
    if override in ("0", "false", "no"):
        return False
    return _environment() == "production"


def seed_where(alias: str = "") -> str:
    """SQL fragment to AND into a public read, or '' when seeds are
    allowed. `alias` is the table alias used by the caller ('a.' style
    prefixes are built here so call sites stay one-liners).

        wheres.append(seed_where("a")) if seed_where("a") else None

    Returns a complete predicate, e.g. `a.is_seed = FALSE`.
    """
    if not hide_seed_rows():
        return ""
    prefix = f"{alias}." if alias else ""
    return f"{prefix}is_seed = FALSE"
