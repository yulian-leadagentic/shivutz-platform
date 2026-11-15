"""R34 5c · the search log behind "searches in your category".

`search_log` (migration 097) gets one row per POST /search holding the
marketplace category codes the search matched and the region the
rewriter extracted. That is the whole record: no query text, no user
id, no entity id. The provider dashboard counts these rows to tell a
provider how much demand there was for what it sells
(routes/provider_stats.py).

Two rules shape this module:

  1. A search must never fail, or wait, because of its own bookkeeping.
     `record_search` is handed to FastAPI's BackgroundTasks, so it runs
     after the response has gone out, and it swallows every exception.
     A missing table (code deployed ahead of the migration) costs one
     warning line per search and nothing else.

  2. What is stored about the caller is a role, never an identity. The
     role exists so the dashboard can leave out searches made by
     providers and admins, who are not the customers the number is
     meant to describe.
"""
import json
import logging
from typing import Iterable, Optional

from app.db import get_db

_log = logging.getLogger(__name__)

# The roles worth telling apart. Anything else a header might carry is
# stored as NULL rather than trusted into the table.
_VIEWER_TYPES = frozenset({"contractor", "corporation", "service_provider", "admin"})

# Columns are VARCHAR(50) on both marketplace_listings.category and
# search_log.region. A value longer than that is not a real code.
_CODE_MAX = 50


def matched_categories(marketplace_matches: Iterable[dict]) -> list[str]:
    """Distinct category codes among the matched listings, sorted so two
    identical searches write identical rows."""
    codes = set()
    for match in marketplace_matches or ():
        code = match.get("category") if isinstance(match, dict) else None
        if isinstance(code, str) and 0 < len(code) <= _CODE_MAX:
            codes.add(code)
    return sorted(codes)


def viewer_type(x_entity_type: Optional[str], x_user_role: Optional[str]) -> Optional[str]:
    """The caller's role, or None for an anonymous caller.

    An admin has no entity context, so the role header is the only
    place the admin signal arrives."""
    if x_user_role == "admin":
        return "admin"
    role = (x_entity_type or "").lower()
    return role if role in _VIEWER_TYPES else None


def search_row(
    marketplace_matches: Iterable[dict],
    region: Optional[str],
    x_entity_type: Optional[str],
    x_user_role: Optional[str],
    via_fallback: bool,
) -> tuple:
    """The bind params for one search_log row. Split from the write so
    it can be tested without a database."""
    clean_region = region if isinstance(region, str) and 0 < len(region) <= _CODE_MAX else None
    return (
        json.dumps(matched_categories(marketplace_matches)),
        clean_region,
        viewer_type(x_entity_type, x_user_role),
        1 if via_fallback else 0,
    )


def record_search(
    marketplace_matches: Iterable[dict],
    region: Optional[str],
    x_entity_type: Optional[str],
    x_user_role: Optional[str],
    via_fallback: bool,
) -> None:
    """Write one search_log row. Never raises."""
    try:
        row = search_row(marketplace_matches, region, x_entity_type, x_user_role, via_fallback)
        conn = get_db()
        try:
            cur = conn.cursor()
            cur.execute(
                """INSERT INTO search_log (categories, region, viewer_type, via_fallback)
                   VALUES (%s, %s, %s, %s)""",
                row,
            )
            conn.commit()
        finally:
            conn.close()
    except Exception:
        _log.warning("search_log: row not written", exc_info=True)
