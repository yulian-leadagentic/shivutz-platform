"""What a Cardcom document says was sold: one line per charge kind.

A tax invoice is a formal document, so its line names the service as the
terms of use define it: a listing board and a channel for passing
information. Plan names are the Hebrew ones the billing page shows, never
the tier code. {MM/YYYY} is the month the charge is made, Israel time.

Every builder returns a non-empty line; charge_token refuses a document
without one (cardcom._invoice_line).
"""
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

_IL = ZoneInfo("Asia/Jerusalem")

# The names /billing shows for each tier (app/billing/page.tsx).
TIER_NAMES_HE = {"basic": "בסיסי", "advanced": "מתקדם", "pro": "פרו"}


def billing_month(at: Optional[datetime] = None) -> str:
    at = at.astimezone(_IL) if at else datetime.now(_IL)
    return at.strftime("%m/%Y")


def _tier_name(tier: str) -> str:
    name = TIER_NAMES_HE.get(tier)
    if not name:
        raise ValueError(f"invoice_tier_unknown:{tier}")
    return name


def subscription(tier: str, at: Optional[datetime] = None) -> str:
    """A contractor's or corporation's monthly plan, at start or renewal."""
    return f"מנוי לפלטפורמת TagidAI, מסלול {_tier_name(tier)}, {billing_month(at)}"


def extra_seats(tier: str, count: int, at: Optional[datetime] = None) -> str:
    """Users bought on top of a plan."""
    users = "משתמש נוסף" if count == 1 else f"{count} משתמשים נוספים"
    return f"{users} במנוי לפלטפורמת TagidAI, מסלול {_tier_name(tier)}, {billing_month(at)}"


def marketplace_plan(category_name: Optional[str], at: Optional[datetime] = None) -> str:
    """A service provider's advertising plan. If the category's name could
    not be read, the line still says what was sold, without it."""
    category = (category_name or "").strip()
    if category:
        return f"פרסום בפלטפורמת TagidAI, קטגוריית {category}, {billing_month(at)}"
    return f"פרסום בפלטפורמת TagidAI, {billing_month(at)}"


def contact_reveal() -> str:
    """Revealing the contact details of an import request's rows, once that
    is charged."""
    return "חשיפת פרטי קשר בפלטפורמת TagidAI"
