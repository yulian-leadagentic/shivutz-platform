# U6 §2b-1 · shared search-term normalization.
#
# One implementation, two callers: /marketplace (LIKE over
# marketplace_listings) and any future federated-search branch. This
# module is the "פונקציה אחת" the U6 spec demanded — do NOT re-implement
# the normalization in a route.
#
# What it does, in this order:
#
#   1. strip surrounding whitespace
#   2. drop trailing/leading punctuation that Hebrew users type by
#      habit (comma, period, semicolon, colon, exclamation, question,
#      quotes, apostrophe, dashes, parens) — but ONLY at the edges of
#      the whole string AND at the edges of each space-separated word.
#      Punctuation INSIDE a word survives: בע"מ · ד"ר · צה"ל · Y'know.
#   3. collapse runs of whitespace to a single space
#   4. escape SQL LIKE wildcards % and _ so the input `100%` cannot
#      accidentally match every row.
#
# What it explicitly does NOT do:
#
#   - No stopword removal (Hebrew "או", "עם", ו- prefix).
#   - No stemming.
#   - No unicode normalization (NFC/NFD) — MySQL's utf8mb4_unicode_ci
#     already handles case-fold equivalents.
#
# Return value: `(pattern, tokens)` where `pattern` is the full-string
# LIKE fragment (e.g. `%ביטוח%`) and `tokens` is the list of
# space-separated word-LIKE fragments (e.g. [`%ביטוח%`, `%הסעות%`]).
# Callers decide which to use — the marketplace route uses `tokens`
# joined with AND so multi-word queries stay conjunctive; if `tokens`
# is empty (input was only punctuation) the caller should IGNORE the
# search term entirely rather than return zero rows.

from __future__ import annotations

# Whitelist of "edge punctuation" — codepoints that we strip from the
# start and end of each token. Kept explicit so future edits don't
# accidentally add characters like the Hebrew maqaf ־ that belong
# inside a word.
_EDGE_PUNCT = frozenset(",.;:!?\"'()[]{}—-–")


def _strip_edge_punct(word: str) -> str:
    """Strip _EDGE_PUNCT from both ends of `word`. Interior chars stay."""
    i, j = 0, len(word)
    while i < j and word[i] in _EDGE_PUNCT:
        i += 1
    while j > i and word[j - 1] in _EDGE_PUNCT:
        j -= 1
    return word[i:j]


def _escape_like(word: str) -> str:
    """Escape MySQL LIKE wildcards so user input can't inject them."""
    # Order matters: escape the backslash first, then the wildcards, or
    # the wildcards' escaped forms get double-escaped.
    return word.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def normalize_search_term(raw: str | None) -> tuple[str, list[str]]:
    """Normalize a user-typed search term for use in a SQL LIKE.

    Args:
      raw: whatever came off the query string. May be None, empty,
           whitespace-only, or full of trailing punctuation.

    Returns:
      (pattern, tokens):
        pattern -- '%<full-normalized>%' (or '' when nothing survived).
        tokens  -- list of '%<word>%' for each surviving whitespace-
                   separated word. Empty when the input reduces to
                   nothing. Callers should treat an empty list as
                   "no search filter" — do NOT emit an always-false
                   WHERE clause, that would silently return zero rows.
    """
    if not raw:
        return "", []
    s = raw.strip()
    if not s:
        return "", []
    # Split on whitespace, strip edge punctuation from each word, drop
    # words that reduce to nothing (e.g. a lone comma).
    words = [_strip_edge_punct(w) for w in s.split()]
    words = [w for w in words if w]
    if not words:
        return "", []
    # Escape LIKE wildcards per token, then reassemble.
    escaped_words = [_escape_like(w) for w in words]
    full = " ".join(escaped_words)
    pattern = f"%{full}%"
    tokens = [f"%{w}%" for w in escaped_words]
    return pattern, tokens
