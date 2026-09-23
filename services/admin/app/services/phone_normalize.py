# R30 §15 · MIRROR of services/user-org/app/services/phone_normalize.py
#
# Why a copy and not an import: Railway builds each service from its
# own subtree, so `from services.user_org...` resolves at lint time
# and ImportErrors at runtime. That exact mistake shipped once (R29
# §3, the sponsor_sizes catalog) and failed silently — the stub
# returned a default and every ad rendered wrong for a day. Mirroring
# is deliberate; drift is not, hence the guard at the bottom.
#
# Rule (identical to the user-org copy and to
# services/auth/src/otp.js:normalisePhone):
#   1. reject empty / None
#   2. strip cosmetic formatting (space, dash, parens)
#   3. what remains MUST be `+?<digits>` — letters, punctuation and
#      emoji are rejected as `invalid_phone`
#   4. valid shapes:
#        digits.startswith('972') and len == 12  → '+' + digits
#        digits.startswith('0')   and len == 10  → digits unchanged
#
# 🔴 Do not "improve" this file on its own. Edit the user-org copy,
# copy it here verbatim, then update _CANONICAL_BEHAVIOR_HASH in BOTH
# (the value is printed by running either file directly).

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


_MESSAGES_HE = {
    "phone_required": "יש להזין מספר טלפון",
    "invalid_phone":  "מספר טלפון לא תקין. יש להזין מספר ישראלי בפורמט 05XXXXXXXX",
}


def message_he(code: str) -> str:
    return _MESSAGES_HE.get(code, _MESSAGES_HE["invalid_phone"])


def normalize_or_400(raw: Optional[str], *, required: bool = True) -> Optional[str]:
    """Canonical phone for a write path, or HTTP 400 with Hebrew.

    `required=False` lets a blank optional field through as None
    instead of rejecting it. A value that is PRESENT is always
    validated: "optional" means "may be absent", never "may be
    malformed".
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


# ── R30 §15 · drift guard ────────────────────────────────────────────
#
# Fingerprints BEHAVIOUR, not source text. Hashing the file would trip
# on a reworded comment while missing a genuine logic change made in
# equivalent-looking code; running a fixed probe set through the
# function and hashing the OUTCOMES catches exactly the thing that
# matters and nothing that doesn't.
#
# The probes deliberately include the inputs that caused real
# incidents: "0525267879גגג" (14.09, Hebrew letters reached the DB and
# propagated into an SMS payload) and "090998798677868" (22.09, fifteen
# digits stored on a support ticket).
#
# Crash policy follows the sponsor_sizes precedent, for the reason
# Yulian gave there: admin is the narrower blast radius, so it fails
# hard; user-org must never fail to boot, so its copy logs and
# continues. A dead admin service is an inconvenience — a dead
# user-org is a full outage.
_PROBES = (
    None, "", "   ",
    "0525267879", "+972525267879", "972525267879",
    "052-526-7879", "052 526 7879", "(052)526-7879",
    "0525267879גגג", "052😀5267879", "052/5267879",
    "05252678799", "052526787", "090998798677868",
    "+9725252678790", "00972525267879",
)


def _behavior_fingerprint() -> str:
    import hashlib
    lines = []
    for probe in _PROBES:
        try:
            lines.append(f"{probe!r}=>{normalize_israeli_phone(probe)}")
        except InvalidPhone as exc:
            lines.append(f"{probe!r}=>!{exc.code}")
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


_CANONICAL_BEHAVIOR_HASH = "f98fe5cb79b2c69b98ed9ffee23ac4c3cb7bec5b613e7593be964599d555452b"

_actual = _behavior_fingerprint()
if _actual != _CANONICAL_BEHAVIOR_HASH:
    raise RuntimeError(
        "phone_normalize behaviour drift detected in services/admin.\n"
        f"  computed: {_actual}\n"
        f"  expected: {_CANONICAL_BEHAVIOR_HASH}\n"
        "This copy MUST match services/user-org/app/services/phone_normalize.py. "
        "Edit the user-org copy, mirror it here verbatim, then update "
        "_CANONICAL_BEHAVIOR_HASH in BOTH files."
    )


if __name__ == "__main__":  # pragma: no cover — dev helper
    print(_behavior_fingerprint())
