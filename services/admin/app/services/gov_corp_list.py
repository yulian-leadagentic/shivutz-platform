"""Parser for the רשות האוכלוסין וההגירה annual manpower-corps PDF.

The file lists "קבלני כוח אדם בעלי היתר להעסיק עובדים זרים בענף הבניין".
Layout (physical, left-to-right):

    מס' טל'   |   כתובת   |   מס' ח.פ.   |   שם התאגיד   |   מס"ד

Hebrew is RTL so logical reading order is reversed: serial, name,
business_number, address, phone. pdfplumber returns cells in physical
(left-to-right) order, so we reverse per row.

The parser is forgiving:
  - Rows with no parseable ח.פ → skipped (kept in raw_row for audit only)
  - Rows with multiple ח.פ in one cell → first one wins (per product
    decision; the rest are stored in raw_row for manual lookup)
  - Phone cells with 2 numbers separated by / , ; newline → split
  - Phones with 9 digits and no leading 0 → '0' prepended
  - Distinguish mobile (05X) from landline (everything else); push first
    of each type into phone_mobile_1 / phone_landline_1 respectively

Returns a list of dicts ready to INSERT into gov_corporations_registry.
"""
from __future__ import annotations

import io
import json
import logging
import re
import uuid
from typing import Any, Iterable

log = logging.getLogger(__name__)

# Israeli business numbers are exactly 9 digits.
BUSINESS_NUMBER_RE = re.compile(r"\b\d{9}\b")

# Phone-splitter — separators we've seen in the gov file: / , ; or
# newline (when 2 phones were stacked in one cell).
PHONE_SPLIT_RE = re.compile(r"[/,;\n]+")

# After splitting, each phone candidate may still have dashes or spaces;
# strip them and keep only digits + optional leading '+'.
PHONE_KEEP_RE = re.compile(r"[^\d+]")

# Hebrew Unicode block — used to detect cells we should reverse.
HEBREW_BLOCK_RE = re.compile(r"[֐-׿]")

# Digit runs inside the reversed cell get re-reversed so a numeric token
# like "76" doesn't end up as "67".
DIGIT_RUN_RE = re.compile(r"\d+")


def _visual_to_logical_hebrew(s: str | None) -> str | None:
    """pdfplumber returns Hebrew strings in *visual* order (each cell's
    characters laid out left-to-right exactly as they appear on the page).
    Logical reading order — what you'd type, store in a DB, send to a
    browser — is the reverse, except digit runs need to stay forward.

    Example:
       PDF cell  →  "תורדש 76 לטפסוי"   (visual order — what's on the page)
       Logical   →  "יוספטל 76 שדרות"   ("Yoseftal 76, Sderot")

    Implementation: reverse the whole string, then re-reverse every digit
    run so numeric tokens read normally again. Strings that contain no
    Hebrew characters are passed through unchanged — keeps Latin / mixed
    company names intact.
    """
    if not s:
        return s
    if not HEBREW_BLOCK_RE.search(s):
        return s
    rev = s[::-1]
    return DIGIT_RUN_RE.sub(lambda m: m.group(0)[::-1], rev)


def _normalize_phone(raw: str) -> str | None:
    """Return a canonical digit-only phone or None if it doesn't look like one.

    Rules:
      - 9 digits, no leading 0 → prepend 0 (e.g. '504822777' → '0504822777')
      - 10 digits starting with 0 → keep as-is
      - 9 digits starting with 0 (landline like '03-1234567') → keep as-is
      - +972XXXXXXXXX → convert to local 0XXXXXXXXX
      - Anything shorter than 9 digits or longer than 12 → reject
    """
    if not raw:
        return None
    digits = PHONE_KEEP_RE.sub("", raw)
    if digits.startswith("+972"):
        digits = "0" + digits[4:]
    elif digits.startswith("972"):
        digits = "0" + digits[3:]
    # Drop any remaining '+'
    digits = digits.replace("+", "")
    if not digits.isdigit():
        return None
    if len(digits) == 9 and not digits.startswith("0"):
        # The user-requested rule: 9 digits without leading 0 → prepend 0
        # Covers '504822777' (mobile w/o 0) and '36750915' (landline w/o 0).
        digits = "0" + digits
    if len(digits) < 9 or len(digits) > 11:
        return None
    return digits


def _is_mobile(phone: str) -> bool:
    """Israeli mobile prefixes: 050-059. We treat 04/07X/072/073/074
    technically-mobile-looking VoIP prefixes as landline since the corp
    profile distinguishes 'cell' from 'office'."""
    return phone.startswith("05")


def _classify_phones(cell: str) -> tuple[list[str], list[str]]:
    """Split a single PDF cell (which may carry multiple numbers) into
    (mobiles, landlines)."""
    mobiles: list[str] = []
    landlines: list[str] = []
    for candidate in PHONE_SPLIT_RE.split(cell):
        norm = _normalize_phone(candidate)
        if not norm:
            continue
        # Dedupe — same number written twice in one cell happens
        if norm in mobiles or norm in landlines:
            continue
        if _is_mobile(norm):
            mobiles.append(norm)
        else:
            landlines.append(norm)
    return mobiles, landlines


def _first_business_number(cell: str) -> str | None:
    """Extract the FIRST 9-digit business number from the cell.

    Some PDF rows have two ח.פ stacked vertically — we take the topmost
    (which pdfplumber reads first). The discarded numbers stay in raw_row.
    """
    if not cell:
        return None
    m = BUSINESS_NUMBER_RE.search(cell)
    return m.group(0) if m else None


def _to_int_or_none(s: Any) -> int | None:
    if s is None:
        return None
    try:
        return int(str(s).strip())
    except (ValueError, TypeError):
        return None


def parse_pdf_bytes(pdf_bytes: bytes) -> list[dict[str, Any]]:
    """Parse the gov corps PDF and return a list of normalized rows.

    Each row is a dict with the same shape as the
    gov_corporations_registry columns (minus id/imported_at/imported_by
    which the route handler fills in).
    """
    # Lazy import — pdfplumber pulls in pdfminer + Pillow, ~30MB. We
    # don't want it loaded for every admin request, just this endpoint.
    import pdfplumber

    rows: list[dict[str, Any]] = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            try:
                tables = page.extract_tables() or []
            except Exception as e:
                log.warning("pdfplumber page.extract_tables failed: %s", e)
                continue
            for table in tables:
                for raw in table:
                    if not raw:
                        continue
                    # pdfplumber returns cells in physical left-to-right
                    # order. The Hebrew file reads right-to-left so the
                    # serial column is the LAST cell of the physical row.
                    # Strip None cells + whitespace, then reverse.
                    cells = [(c or "").strip() for c in raw]
                    if not any(cells):
                        continue
                    # Expected width is 5; sometimes pdfplumber merges a
                    # cell so we get 4. Pad to 5 (logical) by adding
                    # blanks on the missing side.
                    if len(cells) < 5:
                        cells = cells + [""] * (5 - len(cells))
                    elif len(cells) > 5:
                        # Some rows have an extra empty column from
                        # pdfplumber's grid detection — drop trailing
                        # blanks first, then trim leading blanks.
                        while len(cells) > 5 and cells[-1] == "":
                            cells.pop()
                        while len(cells) > 5 and cells[0] == "":
                            cells.pop(0)
                        if len(cells) != 5:
                            # Unusual shape — keep raw for audit only.
                            log.info("skip row with %d cells: %r", len(cells), cells)
                            continue
                    # Physical order: [phone, address, business_number, name, serial]
                    phone_cell, address_cell, bn_cell, name_cell, serial_cell = cells

                    # Skip the header row.
                    if "ח.פ" in bn_cell or "התאגיד" in name_cell:
                        continue

                    # The name + address cells come back from pdfplumber in
                    # visual order — flip them to logical reading order
                    # before storing so admin sees correct Hebrew everywhere.
                    name_he    = _visual_to_logical_hebrew(name_cell or None)
                    address_he = _visual_to_logical_hebrew(address_cell or None)

                    business_number = _first_business_number(bn_cell)
                    if not business_number:
                        # Without a ח.פ the row can't auto-match a corp.
                        # Keep it in audit form so admin can spot-check.
                        rows.append({
                            "business_number": None,
                            "serial_no": _to_int_or_none(serial_cell),
                            "company_name_he": name_he,
                            "address": address_he,
                            "phone_mobile_1": None,
                            "phone_mobile_2": None,
                            "phone_landline_1": None,
                            "phone_landline_2": None,
                            "raw_row": {"cells": cells, "reason": "no_business_number"},
                        })
                        continue

                    mobiles, landlines = _classify_phones(phone_cell)
                    rows.append({
                        "business_number": business_number,
                        "serial_no": _to_int_or_none(serial_cell),
                        "company_name_he": name_he,
                        "address": address_he,
                        "phone_mobile_1":   mobiles[0]   if len(mobiles)   >= 1 else None,
                        "phone_mobile_2":   mobiles[1]   if len(mobiles)   >= 2 else None,
                        "phone_landline_1": landlines[0] if len(landlines) >= 1 else None,
                        "phone_landline_2": landlines[1] if len(landlines) >= 2 else None,
                        "raw_row": {"cells": cells},
                    })
    return rows


def insert_rows(conn, rows: Iterable[dict[str, Any]], source_year: int, admin_user_id: str | None) -> int:
    """Replace all rows for `source_year` with `rows`. Returns the
    count of rows inserted (excluding the deleted set)."""
    cur = conn.cursor()
    cur.execute(
        "DELETE FROM org_db.gov_corporations_registry WHERE source_year = %s",
        (source_year,),
    )
    inserted = 0
    for r in rows:
        cur.execute(
            """INSERT INTO org_db.gov_corporations_registry
                 (id, source_year, serial_no, business_number, company_name_he,
                  address, phone_mobile_1, phone_mobile_2, phone_landline_1,
                  phone_landline_2, raw_row, imported_by)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                str(uuid.uuid4()), source_year, r.get("serial_no"),
                r.get("business_number"), r.get("company_name_he"),
                r.get("address"), r.get("phone_mobile_1"), r.get("phone_mobile_2"),
                r.get("phone_landline_1"), r.get("phone_landline_2"),
                json.dumps(r.get("raw_row"), ensure_ascii=False) if r.get("raw_row") else None,
                admin_user_id,
            ),
        )
        inserted += 1
    conn.commit()
    return inserted


def lookup_corp(conn, business_number: str) -> dict | None:
    """Return the most-recent-year registry row that matches the given
    business_number, or None if not found."""
    if not business_number:
        return None
    cur = conn.cursor()
    cur.execute(
        """SELECT * FROM org_db.gov_corporations_registry
           WHERE business_number = %s
           ORDER BY source_year DESC
           LIMIT 1""",
        (business_number,),
    )
    return cur.fetchone()


def latest_year(conn) -> int | None:
    """Return the most recent source_year that has any rows, or None."""
    cur = conn.cursor()
    cur.execute(
        "SELECT MAX(source_year) AS y FROM org_db.gov_corporations_registry"
    )
    row = cur.fetchone()
    return row["y"] if row and row.get("y") else None
