# U8 §4c · server-side border for Israeli phone numbers.
#
# The frontend's checkIsraeliPhone (lib/phone.ts) now sends the
# canonical form to the API, but this route is also reachable by
# direct HTTP calls that bypass the client. Mirror the same strict
# rule here so an `invited_phone` row can never end up containing
# Hebrew letters or emoji again — the exact regression from Yulian's
# 14.09 report ("0525267879גגג" landed in DB, then propagated to the
# team.invited SMS payload).
#
# Rule (identical to services/auth/src/otp.js:normalisePhone after
# the U8 §4c fix there):
#   1. reject empty / None
#   2. strip trailing whitespace + cosmetic formatting
#      (space, dash, parens)
#   3. what remains MUST be `+?<digits>` — anything else (letters,
#      punctuation, emoji) is rejected as `invalid_phone`
#   4. valid shapes:
#        digits.startswith('972') and len == 12  → return '+' + digits
#        digits.startswith('0')   and len == 10  → return digits unchanged
#
# Returns the canonical 10-digit or +972 form. Raises ValueError with
# a stable code string on rejection so the caller can map to a
# fastapi HTTPException with the right status + code.

from __future__ import annotations

import re
from typing import Optional


class InvalidPhone(ValueError):
    """Raised when the phone value cannot be normalized. `code` matches
    the frontend CODE_TO_HE keys so mapApiError picks up the Hebrew
    copy automatically."""
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


_COSMETIC = re.compile(r"[\s\-()]")
_SHAPE    = re.compile(r"^\+?\d+$")


def normalize_israeli_phone(raw: Optional[str]) -> str:
    if not raw or not str(raw).strip():
        raise InvalidPhone("phone_required")
    stripped = _COSMETIC.sub("", str(raw).strip())
    if not _SHAPE.match(stripped):
        raise InvalidPhone("invalid_phone")
    digits = stripped.lstrip("+")
    if digits.startswith("972") and len(digits) == 12:
        return "+" + digits
    if digits.startswith("0") and len(digits) == 10:
        return digits
    raise InvalidPhone("invalid_phone")


# ── R30 §15 · HTTP mapping ───────────────────────────────────────────
#
# Every write path that takes a phone needs the same three things:
# normalize, reject with 400 (never a 500 from an unhandled raise),
# and say why in Hebrew. Doing that inline at each call site is how
# the codebase ended up with two paths normalizing and eight not, so
# it lives here as a one-liner the routes call.
#
# The `code` still rides in the detail because the frontend's
# mapApiError keys off it (CODE_TO_HE in lib/api/errors.ts); the
# Hebrew string is added so a direct API caller — curl, Postman, an
# integration — gets a readable reason instead of a bare token.
_MESSAGES_HE = {
    "phone_required": "יש להזין מספר טלפון",
    "invalid_phone":  "מספר טלפון לא תקין. יש להזין מספר ישראלי בפורמט 05XXXXXXXX",
}


def message_he(code: str) -> str:
    return _MESSAGES_HE.get(code, _MESSAGES_HE["invalid_phone"])


def normalize_or_400(raw: Optional[str], *, required: bool = True) -> Optional[str]:
    """Canonical phone for a write path, or HTTP 400 with Hebrew.

    `required=False` lets a blank optional field through as None
    instead of rejecting it — a support ticket may legitimately carry
    no callback number. A value that is PRESENT is always validated:
    "optional" means "may be absent", never "may be malformed".

    Import fastapi lazily so the module stays usable (and testable)
    outside a request context — test_phone_normalize.py imports it
    directly.
    """
    from fastapi import HTTPException

    if raw is None or not str(raw).strip():
        if not required:
            return None
        raise HTTPException(
            status_code=400,
            detail={"code": "phone_required", "error": "phone_required",
                    "message": message_he("phone_required")},
        )
    try:
        return normalize_israeli_phone(raw)
    except InvalidPhone as e:
        raise HTTPException(
            status_code=400,
            detail={"code": e.code, "error": e.code, "message": message_he(e.code)},
        )
