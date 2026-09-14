# U8 §4c acceptance tests. Run with `python -m pytest services/user-org`.
# These MUST stay in sync with the frontend-side phone tests
# (services/frontend/tests/phone.test.mjs) — the rule is identical
# by design.

import pytest

from app.services.phone_normalize import InvalidPhone, normalize_israeli_phone


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
