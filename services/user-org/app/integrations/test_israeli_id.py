# R34 P2 acceptance tests. Run with `python -m pytest services/user-org`.
# These MUST stay in sync with the frontend-side mirror
# (services/frontend/tests/businessNumber.test.mjs) — the rule is
# identical by design; the server is the authority and the client
# check exists only so a typo is caught before a round trip.

from app.integrations.israeli_id import (
    BN_CHECKSUM,
    BN_FORMAT,
    BN_REQUIRED,
    check_business_number,
    is_valid_israeli_id,
)


# ── the checksum itself ──────────────────────────────────────────

def test_known_valid_personal_id():
    assert is_valid_israeli_id("123456782") is True


def test_known_valid_company_number():
    assert is_valid_israeli_id("514000009") is True


def test_off_by_one_last_digit_is_invalid():
    assert is_valid_israeli_id("123456783") is False
    assert is_valid_israeli_id("123456781") is False


def test_off_by_one_middle_digit_is_invalid():
    assert is_valid_israeli_id("123466782") is False


def test_all_zeros_is_invalid():
    # 0 mod 10 == 0, so the arithmetic alone accepts this. It is the
    # classic "get past the required field" placeholder.
    assert is_valid_israeli_id("000000000") is False
    assert is_valid_israeli_id("00000000") is False
    assert is_valid_israeli_id("0") is False


def test_non_digits_are_invalid():
    assert is_valid_israeli_id("12345678a") is False
    assert is_valid_israeli_id("") is False
    assert is_valid_israeli_id("12-345-678") is False


def test_more_than_nine_digits_is_invalid():
    assert is_valid_israeli_id("1234567890") is False


# ── what a person types into the provider form ───────────────────

def test_valid_nine_digits_returned_unchanged():
    assert check_business_number("123456782") == ("123456782", None)


def test_surrounding_whitespace_is_ignored():
    assert check_business_number("  123456782 ") == ("123456782", None)


def test_eight_digits_are_padded_with_a_leading_zero():
    # 012345674 is valid; its owner will often type 12345674.
    assert check_business_number("12345674") == ("012345674", None)


def test_eight_digits_that_fail_once_padded_are_rejected():
    assert check_business_number("12345675") == (None, BN_CHECKSUM)


def test_padded_and_unpadded_forms_canonicalise_to_the_same_value():
    # The duplicate guard compares canonical forms. If these two ever
    # differ, one business can register twice.
    assert check_business_number("12345674")[0] == check_business_number("012345674")[0]


def test_empty_and_blank_are_required_errors():
    assert check_business_number("") == (None, BN_REQUIRED)
    assert check_business_number("   ") == (None, BN_REQUIRED)
    assert check_business_number(None) == (None, BN_REQUIRED)


def test_wrong_length_is_a_format_error_not_a_checksum_error():
    assert check_business_number("12345") == (None, BN_FORMAT)
    assert check_business_number("1234567") == (None, BN_FORMAT)
    assert check_business_number("1234567890") == (None, BN_FORMAT)


def test_letters_are_a_format_error():
    assert check_business_number("12345678a") == (None, BN_FORMAT)


def test_all_zeros_is_rejected_at_both_lengths():
    assert check_business_number("000000000") == (None, BN_CHECKSUM)
    assert check_business_number("00000000") == (None, BN_CHECKSUM)


def test_off_by_one_is_a_checksum_error():
    assert check_business_number("123456783") == (None, BN_CHECKSUM)
