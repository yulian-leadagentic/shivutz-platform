"""Israeli national-ID checksum validator.

Same Luhn-variant algorithm validates both ת.ז (personal) and ח.פ (corporate)
9-digit numbers, since the registries use the same checksum scheme.
"""


def is_valid_israeli_id(value: str) -> bool:
    if not value or not value.isdigit():
        return False
    digits = value.zfill(9)
    if len(digits) != 9:
        return False
    total = 0
    for i, ch in enumerate(digits):
        n = int(ch) * (1 if i % 2 == 0 else 2)
        if n > 9:
            n -= 9
        total += n
    return total % 10 == 0
