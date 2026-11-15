"""R34 4c · the fields a marketplace category asks, and a listing's answers.

A category's `field_schema` (marketplace_categories, seeded by migration
102) says what its listings are asked. A listing's `attributes` holds the
answers. This module is the server's side of that contract:

  * validate_attributes   types, required fields, option lists, and no
                          key the schema does not name
  * card_price            which answer is the price a card shows
  * attribute_view        the answers with the schema's labels, for the
                          detail panel
  * validate_regions      the regions a listing serves

The schema is data. Nothing here knows a category by name.
"""
import json
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Optional

from fastapi import HTTPException

# worker_db.regions.code. The same set the query rewriter validates a
# search's region against, so a listing cannot be filed under a region no
# search can ask for.
from app.services.query_rewriter import VALID_REGIONS

FIELD_TYPES = ("text", "int", "money", "bool", "select", "multi", "date")
ANYWHERE = "national"

_TEXT_MAX = 200
_INT_MAX = 1_000_000
_MONEY_MAX = Decimal("10000000")


class _Bad(Exception):
    """One field's value is not acceptable; the message is for the user."""


def parse_schema(raw: Any) -> Optional[dict]:
    """A category's field_schema column as a dict, or None when the
    category has none. The column comes back from MySQL as a string."""
    if raw is None or raw == "":
        return None
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return None
    if not isinstance(raw, dict) or not isinstance(raw.get("fields"), list):
        return None
    return raw


def load_schema(cur, category: str) -> Optional[dict]:
    cur.execute(
        "SELECT field_schema FROM marketplace_categories WHERE code = %s",
        (category,),
    )
    row = cur.fetchone()
    return parse_schema(row.get("field_schema")) if row else None


def _is_empty(value: Any) -> bool:
    return value is None or value == "" or value == []


def _clean(field: dict, value: Any) -> Any:
    kind = field.get("type")
    options = field.get("options") or []

    if kind == "text":
        if not isinstance(value, str):
            raise _Bad("יש להזין טקסט")
        value = value.strip()
        if len(value) > _TEXT_MAX:
            raise _Bad(f"עד {_TEXT_MAX} תווים")
        return value

    if kind == "int":
        # bool is an int in Python; True must not pass for 1.
        if isinstance(value, bool) or not isinstance(value, int):
            raise _Bad("יש להזין מספר שלם")
        if value < 0 or value > _INT_MAX:
            raise _Bad("המספר מחוץ לטווח")
        return value

    if kind == "money":
        if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
            raise _Bad("יש להזין סכום")
        try:
            amount = Decimal(str(value))
        except InvalidOperation:
            raise _Bad("יש להזין סכום")
        if not amount.is_finite() or amount < 0 or amount > _MONEY_MAX:
            raise _Bad("הסכום מחוץ לטווח")
        if amount != amount.quantize(Decimal("0.01")):
            raise _Bad("עד שתי ספרות אחרי הנקודה")
        return int(amount) if amount == amount.to_integral_value() else float(amount)

    if kind == "bool":
        if not isinstance(value, bool):
            raise _Bad("יש לבחור כן או לא")
        return value

    if kind == "select":
        if not isinstance(value, str) or value not in options:
            raise _Bad("יש לבחור אחת מהאפשרויות")
        return value

    if kind == "multi":
        if not isinstance(value, list) or any(not isinstance(v, str) for v in value):
            raise _Bad("יש לבחור מתוך האפשרויות")
        if any(v not in options for v in value):
            raise _Bad("יש לבחור מתוך האפשרויות")
        # the schema's order, each option once
        return [o for o in options if o in value]

    if kind == "date":
        if not isinstance(value, str):
            raise _Bad("יש להזין תאריך")
        try:
            return datetime.strptime(value, "%Y-%m-%d").strftime("%Y-%m-%d")
        except ValueError:
            raise _Bad("יש להזין תאריך")

    raise _Bad("סוג שדה לא מוכר")


def validate_attributes(schema: Optional[dict], attributes: Any) -> dict:
    """The attributes as they will be stored. 400 `invalid_attributes`
    with a message per field when they do not fit the schema.

    An answer left empty is simply not stored. `False` is an answer.
    """
    if attributes is None:
        attributes = {}
    if not isinstance(attributes, dict):
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_attributes", "message": "פרטי המודעה אינם תקינים.", "fields": {}},
        )

    fields = (schema or {}).get("fields") or []
    known = {f["key"]: f for f in fields}
    errors: dict[str, str] = {}

    for key in attributes:
        if key not in known:
            errors[str(key)] = "שדה לא מוכר בקטגוריה זו"

    clean: dict = {}
    for key, field in known.items():
        value = attributes.get(key)
        if _is_empty(value) or (isinstance(value, str) and not value.strip()):
            if field.get("required"):
                errors[key] = "שדה חובה"
            continue
        try:
            cleaned = _clean(field, value)
        except _Bad as bad:
            errors[key] = str(bad)
            continue
        if _is_empty(cleaned):
            if field.get("required"):
                errors[key] = "שדה חובה"
            continue
        clean[key] = cleaned

    for group in (schema or {}).get("require_any") or []:
        if not any(k in clean for k in group) and not any(k in errors for k in group):
            labels = [known[k]["label"] for k in group if k in known]
            for k in group:
                errors[k] = "יש למלא לפחות אחד: " + ", ".join(labels)

    # A price and its unit are one answer: either both or neither.
    price = (schema or {}).get("price") or {}
    amount_key, unit_key = price.get("amount"), price.get("unit")
    if amount_key and unit_key and amount_key not in errors and unit_key not in errors:
        if (amount_key in clean) != (unit_key in clean):
            missing = unit_key if amount_key in clean else amount_key
            errors[missing] = "יש למלא מחיר ויחידת מחיר יחד"

    if errors:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "invalid_attributes",
                "message": "חלק מפרטי המודעה אינם תקינים.",
                "fields": errors,
            },
        )
    return clean


def card_price(schema: Optional[dict], clean: dict) -> tuple[Optional[Any], Optional[str]]:
    """(price, unit) for the listing's own `price` and `price_unit`
    columns, which cards and search results read. (None, None) when the
    schema names no price or the listing gave none."""
    price = (schema or {}).get("price") or {}
    if price.get("amount"):
        amount = clean.get(price["amount"])
        if amount is not None:
            return amount, clean.get(price.get("unit") or "")
    for key, unit in price.get("first_of") or []:
        if clean.get(key) is not None:
            return clean[key], unit
    if price.get("note"):
        return None, price["note"]
    return None, None


def attribute_view(schema: Optional[dict], attributes: Any) -> list[dict]:
    """The stored answers in the schema's order, each with its label:
    [{key, label, type, value}]. An answer whose field has since left the
    schema is not shown. Neither are the amount and unit that make up the
    card price: the listing's own `price` and `price_unit` carry them,
    and the panel shows those at the top."""
    if isinstance(attributes, (str, bytes, bytearray)):
        try:
            attributes = json.loads(attributes)
        except (json.JSONDecodeError, UnicodeDecodeError):
            attributes = None
    if not isinstance(attributes, dict) or not schema:
        return []
    price = schema.get("price") or {}
    shown_as_price = {price.get("amount"), price.get("unit")} - {None}
    out = []
    for field in schema.get("fields") or []:
        if field["key"] in shown_as_price:
            continue
        value = attributes.get(field["key"])
        if _is_empty(value):
            continue
        out.append({"key": field["key"], "label": field["label"], "type": field["type"], "value": value})
    return out


def validate_regions(regions: Any) -> Optional[list]:
    """The regions a listing serves, as stored: a list of region codes,
    or None for "not stated". Nationwide swallows the rest."""
    if regions is None or regions == []:
        return None
    if not isinstance(regions, list) or any(not isinstance(r, str) for r in regions):
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_regions", "message": "אזורי השירות אינם תקינים."},
        )
    unknown = [r for r in regions if r not in VALID_REGIONS]
    if unknown:
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_regions", "message": "אזור שירות לא מוכר.", "regions": unknown},
        )
    if ANYWHERE in regions:
        return [ANYWHERE]
    return sorted(set(regions))


def single_region(regions: Optional[list]) -> Optional[str]:
    """What goes in the listing's one-value `region` column: the region
    when there is exactly one, else NULL. Readers that need the full
    answer read `regions`."""
    return regions[0] if regions and len(regions) == 1 else None


# One listing matches a search for region X when it serves X or serves
# everywhere. A listing with `regions` is judged by it; one without is
# judged by its single `region`, where NULL has always meant "anywhere".
# Two placeholders, both the region searched for.
REGION_MATCH_SQL = (
    "((ml.regions IS NOT NULL AND (JSON_CONTAINS(ml.regions, JSON_QUOTE(%s))"
    " OR JSON_CONTAINS(ml.regions, '\"" + ANYWHERE + "\"')))"
    " OR (ml.regions IS NULL AND (ml.region = %s OR ml.region IS NULL OR ml.region = '" + ANYWHERE + "')))"
)
