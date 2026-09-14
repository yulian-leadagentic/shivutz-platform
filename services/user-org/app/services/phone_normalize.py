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
