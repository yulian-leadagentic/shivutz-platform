# U6 §2b-1 acceptance test-cases, encoded so a future edit can't
# silently regress them. Run with `python -m pytest services/user-org`.

from app.services.search_normalize import normalize_search_term


def _tokens(raw):
    return normalize_search_term(raw)[1]


# The four cases the spec listed by name — all must produce the same
# non-empty tokens as the bare word.
def test_trailing_leading_whitespace_and_punctuation_equivalent():
    base = _tokens("ביטוח")
    assert base == ["%ביטוח%"]
    assert _tokens("ביטוח,") == base
    assert _tokens("ביטוח, ") == base
    assert _tokens(" ביטוח") == base
    assert _tokens("ביטוח.") == base


# Hebrew gershayim inside a word must survive — otherwise "בע\"מ",
# "ד\"ר", "צה\"ל" become "בעמ" / "דר" / "צהל" and stop matching.
def test_hebrew_interior_quotes_survive():
    assert _tokens('בע"מ') == ['%בע"מ%']
    assert _tokens('ד"ר') == ['%ד"ר%']


# Multi-word queries with comma-separators must AND their tokens, not
# lose one of them. `ביטוח, הסעות` used to lose the ",".
def test_multi_word_with_comma_produces_and_tokens():
    assert _tokens("ביטוח, הסעות") == ["%ביטוח%", "%הסעות%"]


# `%` and `_` are LIKE wildcards. User input containing them should
# be escaped so `100%` matches literal "100%", not "everything".
def test_like_wildcards_are_escaped():
    _, toks = normalize_search_term("100%")
    assert toks == ["%100\\%%"]
    _, toks = normalize_search_term("a_b")
    assert toks == ["%a\\_b%"]


# When the input is only punctuation / whitespace we return an empty
# tokens list. Callers must interpret that as "no filter" — the fix
# to this bug should not accidentally introduce a new "zero results
# for a lone comma" regression.
def test_only_punctuation_returns_empty():
    assert _tokens("") == []
    assert _tokens(None) == []
    assert _tokens("   ") == []
    assert _tokens(",") == []
    assert _tokens(", .") == []
