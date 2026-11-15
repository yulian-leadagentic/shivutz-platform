"""Israeli national-ID checksum validator.

Same Luhn-variant algorithm validates both ת.ז (personal) and ח.פ (corporate)
9-digit numbers, since the registries use the same checksum scheme. An
authorised dealer's ע.מ number is the owner's ת.ז, so it is covered too.
"""
from typing import Optional, Tuple


def is_valid_israeli_id(value: str) -> bool:
    if not value or not value.isdigit():
        return False
    digits = value.zfill(9)
    if len(digits) != 9:
        return False
    # R34 P2 · all zeros satisfies the checksum (0 mod 10 is 0), so the
    # arithmetic alone called "000000000" a valid number. It is the
    # placeholder people type to get past a required field, and no
    # registry has ever issued it.
    if digits == "000000000":
        return False
    total = 0
    for i, ch in enumerate(digits):
        n = int(ch) * (1 if i % 2 == 0 else 2)
        if n > 9:
            n -= 9
        total += n
    return total % 10 == 0


# Why a business number is refused. Codes rather than raised HTTP
# errors, so this module stays importable, and testable, without the
# web framework.
BN_REQUIRED = "business_number_required"
BN_FORMAT   = "invalid_business_number_format"
BN_CHECKSUM = "invalid_business_number"


def check_business_number(raw: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """R34 P2 · validate and canonicalise a ח.פ / ע.מ as typed by a person.

    Returns `(canonical, None)` when the number is acceptable, where
    `canonical` is always 9 digits, or `(None, code)` with one of the
    `BN_*` codes above.

    Eight digits are accepted and left-padded. A ת.ז that starts with a
    zero is routinely typed without it, and an ע.מ is a ת.ז; refusing
    those would turn away real dealers over a digit they were never
    taught to write. The padded form is what gets stored and compared,
    so `12345678` and `012345678` cannot register as two businesses.
    """
    value = (raw or "").strip()
    if not value:
        return None, BN_REQUIRED
    if not value.isdigit() or len(value) not in (8, 9):
        return None, BN_FORMAT
    if not is_valid_israeli_id(value):
        return None, BN_CHECKSUM
    return value.zfill(9), None
