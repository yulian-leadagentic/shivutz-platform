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
# What `normalize_search_term` explicitly does NOT do:
#
#   - No stopword removal (Hebrew "או", "עם", ו- prefix).
#   - No stemming.
#   - No unicode normalization (NFC/NFD) — MySQL's utf8mb4_unicode_ci
#     already handles case-fold equivalents.
#
# R32 S2 · `marketplace_text_conditions` below is the layer that DOES
# stopword and stem work, and it is now the single matcher for services
# text. Both the federated pass in search.py and `GET /marketplace
# ?search=` call it, so the same query can no longer return a different
# set depending on which door the user came through. Before R32 the
# list endpoint matched three fields with no stemming and no stopwords,
# and "עוד בשירותים נלווים ←" therefore led from a section with results
# to a page without them.
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


# ═══ R32 S2 · the one services text matcher ════════════════════════════
#
# Moved here verbatim from search.py, where it had grown inside
# `_search_marketplace` and was therefore unavailable to the list
# endpoint that the "see more" link led to.

# R28 §2 · short Hebrew connective words that reduce a per-token AND
# to zero when the caller types a natural phrase. `של`, `עם`, `לי`,
# `את`, `זה`, `זו` etc. are dropped. English `for`/`the` thrown in for
# the rare mixed query. Kept intentionally short — a fuller stopword
# list would also drop things like `בית` which some ads use as a real
# term.
_MARKETPLACE_STOPWORDS = frozenset({
    "של", "עם", "לי", "לך", "לו", "לה", "את", "אל", "זה", "זו",
    "אני", "אתה", "הוא", "היא", "אנחנו", "כן", "לא",
    "for", "the", "a", "an", "of", "to", "in", "on",
})

# R32 S3 · words that describe the *request* rather than the service.
# The rewriter has already turned "דיור ל-20 פועלים" into
# ad_type=housing + quantity=20; leaving `פועלים` in a conjunctive AND
# over service titles then zeroes a result set the user would have
# wanted. Separate from the stopwords above because these are content
# words — they just aren't content about the service being sold.
_MARKETPLACE_REQUEST_WORDS = frozenset({
    "עובדים", "פועלים", "צריך", "אני", "מחפש", "מחפשים", "בשביל", "עבור",
})

# R38 item 3b · words about who the service is for, not what it is.
# "לעובדים" in "קורס עברית לעובדים" and in "ביטוח רפואי לעובדים זרים" made
# every query that mentioned workers return both. Compared after a
# one- or two-letter prefix (ל, ה, ו, ב...) is taken off, so "לעובדים"
# and "והפועלים" are caught as well. A query made only of these words,
# region names and the like has no word about a service, and matches no
# service listing.
_MARKETPLACE_GENERIC_WORDS = frozenset({
    "עובד", "עובדים", "עובדת", "עובדות",
    "פועל", "פועלים", "פועלת", "פועלות",
    "זר", "זרים", "זרה", "זרות",
})

# The one-letter words Hebrew attaches to the front of a word: ו ה ב כ ל מ ש,
# up to two of them ("וב", "שה", "מה").
_HE_PREFIX_LETTERS = "והבכלמש"

# The four fields a services query matches against. `mc.name_he` (R28
# §2) is why `דיור` finds listings titled `מתחם מגורים`: they sit in the
# category whose display name is `דיור להשכרה`. Any caller of
# `marketplace_text_conditions` therefore MUST have
# `LEFT JOIN marketplace_categories mc ON mc.code = ml.category` in its
# FROM clause.
_MARKETPLACE_MATCH_FIELDS = ("ml.title", "ml.description", "ml.city", "mc.name_he")

# R38 item 3b · how a query word has to appear in a field. It used to be
# `LIKE %word%`, a fragment anywhere: "טייח לבת ים" found "חבילת ביטוח
# משולבת לתאגידים", because "לבת" sits inside "משולבת" and "ים" inside
# "לתאגידים". A query word now has to be a WORD in the field: a letter
# or digit may not touch it on either side, except up to two Hebrew
# prefix letters in front and a plural or construct ending behind.
# MySQL's REGEXP (ICU) counts Hebrew letters as [:alnum:], on 8.0 and 9.4.
_WORD_ENDINGS = ("ים", "ות", "ה", "ת", "י", "יות")


def _stem_he(word: str) -> str | None:
    """R28 §2 · lightweight Hebrew stem for the search layer.

    A heuristic, NOT morphology — it strips the two most common plural
    suffixes (`ים` masc., `ות` fem.) so `קורסים`→`קורס` and
    `הסעות`→`הסע` match seed data that stores the singular. Only
    applied when the surviving base is still ≥3 chars; a shorter stem
    starts matching partial substrings elsewhere.
    """
    if len(word) <= 4:
        return None
    if word.endswith("ים") and len(word) - 2 >= 3:
        return word[:-2]
    if word.endswith("ות") and len(word) - 2 >= 3:
        return word[:-2]
    return None


def _unwrap(token: str) -> str:
    """Strip the `%` wrappers `normalize_search_term` adds, so the bare
    word can be tested against the stopword list and stemmed."""
    return token[1:-1] if token.startswith("%") and token.endswith("%") else token


def _unescape_like(word: str) -> str:
    """`normalize_search_term` escapes LIKE wildcards with a backslash.
    A regular expression wants the word itself."""
    return word.replace("\\%", "%").replace("\\_", "_").replace("\\\\", "\\")


def _without_prefix(word: str) -> list[str]:
    """The word, and the word with one or two prefix letters taken off,
    longest first, keeping at least two letters."""
    out = [word]
    for n in (1, 2):
        head, rest = word[:n], word[n:]
        if len(rest) >= 2 and all(ch in _HE_PREFIX_LETTERS for ch in head):
            out.append(rest)
    return out


def is_generic_word(word: str) -> bool:
    """R38 item 3b · a word about who a service is for ("עובדים",
    "לפועלים זרים"), which alone says nothing about the service."""
    return any(form in _MARKETPLACE_GENERIC_WORDS for form in _without_prefix(word))


def _regex_escape(word: str) -> str:
    return "".join("\\" + ch if ch in r".^$*+?()[]{}|\-" else ch for ch in word)


def word_pattern(word: str) -> str:
    """The REGEXP a field must match for `word` to count as found in it."""
    cores: list[str] = []
    for form in _without_prefix(word):
        stem = _stem_he(form)
        for core in (form, stem):
            if core and core not in cores:
                cores.append(core)
    alternatives = "|".join(_regex_escape(c) for c in cores)
    endings = "|".join(_WORD_ENDINGS)
    return (f"(^|[^[:alnum:]])[{_HE_PREFIX_LETTERS}]{{0,2}}({alternatives})"
            f"({endings})?([^[:alnum:]]|$)")


def marketplace_text_token_clauses(
    raw_query: str | None,
    *,
    drop_words: frozenset[str] = frozenset(),
    restore_if_alone: frozenset[str] = frozenset(),
) -> list[tuple[str, list[object]]]:
    """R32 S3 · one `(clause, params)` pair per surviving token.

    Each clause is an OR across the four fields in
    `_MARKETPLACE_MATCH_FIELDS`, tried as the raw token and (when one
    exists) its stem. Callers AND them for a precise pass and OR them
    for a zero-result fallback, and `search.py` also reuses each clause
    inside a CASE to score how many tokens a row matched — which is why
    this returns the parts instead of a finished predicate.

    `drop_words` holds bare words the caller has already consumed:
    region names, professions, origins, numbers. Stopwords, the request
    words in `_MARKETPLACE_REQUEST_WORDS` and the generic words in
    `_MARKETPLACE_GENERIC_WORDS` are always dropped.

    R38 item 3b · a query that reduces to nothing but dropped words
    returns no clause, so it matches no listing: a region or a word like
    "עובדים" alone is not a word about a service. It used to keep its
    original tokens, which is how "עובדים בצפון" brought up every
    listing that mentioned workers. The one exception is
    `restore_if_alone`: a dropped word that can name a service as well
    as a trade ("פיגומים" is scaffolders and scaffolding for hire) comes
    back when nothing else is left.

    Each word must appear as a word (`word_pattern`), not as a fragment
    inside another word.
    """
    _, tokens = normalize_search_term(raw_query)
    if not tokens:
        return []

    kept: list[str] = []
    for tok in tokens:
        bare = _unwrap(tok)
        if not bare:
            continue
        if bare in _MARKETPLACE_STOPWORDS:
            continue
        if bare in _MARKETPLACE_REQUEST_WORDS:
            continue
        if bare in drop_words:
            continue
        if is_generic_word(bare):
            continue
        kept.append(_unescape_like(bare))
    if not kept:
        kept = [_unescape_like(_unwrap(tok)) for tok in tokens if _unwrap(tok) in restore_if_alone]

    clauses: list[tuple[str, list[object]]] = []
    for word in kept:
        pattern = word_pattern(word)
        field_clauses = [f"{field} REGEXP %s" for field in _MARKETPLACE_MATCH_FIELDS]
        clauses.append(("(" + " OR ".join(field_clauses) + ")", [pattern] * len(_MARKETPLACE_MATCH_FIELDS)))
    return clauses


def marketplace_text_conditions(
    raw_query: str | None,
    *,
    drop_words: frozenset[str] = frozenset(),
) -> tuple[str, list[object]]:
    """R32 S2 · one SQL predicate for a services text query.

    Returns `(sql, params)`. `sql` is a single parenthesised predicate
    to AND into a `FROM marketplace_listings ml` query, or `''` when
    the query carries no word about a service. The caller decides what
    that means: `/marketplace?search=` answers with no listings.

    Every word the user typed has to land somewhere; that conjunction
    is what makes a two-word query precise, and what makes pruning the
    non-content words matter.
    """
    clauses = marketplace_text_token_clauses(raw_query, drop_words=drop_words)
    if not clauses:
        return "", []
    params: list[object] = []
    for _, token_params in clauses:
        params.extend(token_params)
    return "(" + " AND ".join(sql for sql, _ in clauses) + ")", params
