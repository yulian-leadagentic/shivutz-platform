# U8 §4c acceptance tests. Run with `python -m pytest services/user-org`.
# These MUST stay in sync with the frontend-side phone tests
# (services/frontend/tests/phone.test.mjs) — the rule is identical
# by design.

import pytest

from app.services.phone_normalize import (
    InvalidPhone,
    normalize_israeli_phone,
    normalize_or_400,
)


def test_bare_10_digit_stays_local():
    assert normalize_israeli_phone("0525267879") == "0525267879"


def test_dashes_stripped():
    assert normalize_israeli_phone("052-526-7879") == "0525267879"


def test_spaces_stripped():
    assert normalize_israeli_phone("052 526 7879") == "0525267879"


def test_plus972_returned_as_plus_prefix():
    assert normalize_israeli_phone("+972525267879") == "+972525267879"


def test_972_without_plus_returned_with_plus():
    assert normalize_israeli_phone("972525267879") == "+972525267879"


def test_hebrew_letters_rejected():
    with pytest.raises(InvalidPhone) as exc:
        normalize_israeli_phone("0525267879גגג")
    assert exc.value.code == "invalid_phone"


def test_emoji_rejected():
    with pytest.raises(InvalidPhone):
        normalize_israeli_phone("052😀5267879")


def test_slash_rejected():
    with pytest.raises(InvalidPhone):
        normalize_israeli_phone("052/5267879")


def test_wrong_prefix_rejected():
    with pytest.raises(InvalidPhone) as exc:
        normalize_israeli_phone("08976567654")
    assert exc.value.code == "invalid_phone"


def test_too_short_rejected():
    with pytest.raises(InvalidPhone):
        normalize_israeli_phone("052526")


def test_too_long_rejected():
    with pytest.raises(InvalidPhone):
        normalize_israeli_phone("05252678799")


def test_empty_is_phone_required():
    with pytest.raises(InvalidPhone) as exc:
        normalize_israeli_phone("")
    assert exc.value.code == "phone_required"


def test_whitespace_only_is_phone_required():
    with pytest.raises(InvalidPhone) as exc:
        normalize_israeli_phone("   ")
    assert exc.value.code == "phone_required"


def test_none_is_phone_required():
    with pytest.raises(InvalidPhone) as exc:
        normalize_israeli_phone(None)
    assert exc.value.code == "phone_required"


# ── R30 §15 · normalize_or_400 ───────────────────────────────────────
# The HTTP wrapper every write path now calls. The subtle part is
# `required=False`: "optional" must mean "may be absent", never "may
# be malformed" — that distinction is what let 090998798677868 into
# support_tickets.

def test_or_400_returns_canonical():
    assert normalize_or_400("052-526-7879") == "0525267879"


def test_or_400_optional_blank_is_none():
    assert normalize_or_400(None, required=False) is None
    assert normalize_or_400("", required=False) is None
    assert normalize_or_400("   ", required=False) is None


def test_or_400_optional_but_present_is_still_validated():
    # The support-ticket regression: a supplied value gets checked
    # even though the field itself is optional.
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        normalize_or_400("090998798677868", required=False)
    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "invalid_phone"


def test_or_400_required_blank_is_400_hebrew():
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        normalize_or_400(None)
    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "phone_required"
    # Hebrew, not a bare token — a direct API caller must be able to
    # read the reason (R30 §15: "400 עם הודעה בעברית, לא 500").
    assert any("\u0590" <= ch <= "\u05FF" for ch in exc.value.detail["message"])


def test_or_400_garbage_is_400_not_500():
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        normalize_or_400("0525267879גגג")
    assert exc.value.status_code == 400
