"""Pivot/v2 — free-text → structured query.

Modes:
  fake — regex/keyword extractor. Zero external deps.
  real — Claude Haiku via Anthropic API. Requires ANTHROPIC_API_KEY.

Auto-selection: real mode fires when ANTHROPIC_API_KEY is set AND
LLM_REWRITER_FAKE_MODE is not '1'. Fake mode is the fallback ONLY
when there's no key OR when LLM_REWRITER_FAKE_MODE=1 is explicit.
Falls back to fake if the API call raises or returns unparseable
JSON — search is never blocked by an LLM outage. (Pre-S2 the default
was fake regardless of key presence; the old docstring described the
current behaviour, not the previous one.)

Real-mode results are cached in Redis for 5 minutes (key = sha256 of
the raw query) so repeated searches don't re-bill.
"""
import hashlib
import json
import os
import re
import time
from typing import Optional

# S2 — mode by API-key presence, not by env-var default. `_startup_log`
# below prints the effective mode on module import so an ops person can
# grep the container logs to confirm which path the service is running.
_FAKE_MODE_EXPLICIT = os.getenv("LLM_REWRITER_FAKE_MODE")   # None if unset
_HAS_API_KEY        = bool(os.getenv("ANTHROPIC_API_KEY"))
# Fake only when: (a) explicit LLM_REWRITER_FAKE_MODE=1, OR (b) no API key.
FAKE_MODE = (_FAKE_MODE_EXPLICIT == "1") or (not _HAS_API_KEY)
CACHE_TTL_S = int(os.getenv("LLM_REWRITER_CACHE_TTL", "300"))
# L3 — hard timeout on the Anthropic call. Above this we drop the LLM
# result and fall back to fake-mode so search response time is bounded.
# Search on / must feel instant even during Anthropic degradation.
LLM_TIMEOUT_S = float(os.getenv("LLM_REWRITER_TIMEOUT_S", "3.0"))
# Log any call that took longer than this — noise threshold for tuning.
LLM_SLOW_THRESHOLD_S = float(os.getenv("LLM_REWRITER_SLOW_S", "1.5"))

# Profession keyword → code. Values MUST match worker_db.profession_types.code
# (lowercase english — flooring/mason/plumbing/etc.), not the ad_type enum.
PROFESSION_KEYWORDS: dict[str, str] = {
    "ריצוף": "flooring",   "רצף":   "flooring",   "רצפים": "flooring",   "פרקט":  "flooring",
    "חשמל":  "electrician","חשמלאי":"electrician","חשמלאים":"electrician",
    "צבע":   "painting",   "צבעי":  "painting",   "צבעים": "painting",
    "אינסטל":"plumbing",   "אינסטלטור":"plumbing","שרברב": "plumbing",
    "טייח":  "plastering", "טיוח":  "plastering", "טיח":   "plastering",
    "תפסן":  "formwork",   "טפסן":  "formwork",   "תבניות":"formwork",
    "ברזל":  "skeleton",   "ברזלן": "skeleton",   "ברזלנים":"skeleton",
    "בנאי":  "mason",      "בניה":  "mason",      "בלוקים":"mason",      "בלוקאי":"mason",
    "פיגומ": "scaffolding",
    # Migration 034 renamed the Hebrew display of code `scaffolding`
    # from "פיגומים" to "רתכים" (welders) — keeping the English code
    # stable. Rewriter needs the welder keywords too so search "רתך"
    # reaches the same code and doesn't fall through to a null filter.
    # Two entries because Hebrew's final ך (as in "רתך") is a distinct
    # code-point from regular כ (as in "רתכים"), so one substring key
    # can't cover both singular + plural.
    "רתך":   "scaffolding",  # singular (final-ך)
    "רתכ":   "scaffolding",  # matches "רתכים" (regular-כ, plural)
    "פועל":  "general",    "פועלים":"general",
}

# ISO-2 codes from worker_db.origin_countries.code
ORIGIN_KEYWORDS: dict[str, str] = {
    "סין":   "CN", "סיני":  "CN", "סינים":  "CN", "סינית": "CN",
    "אוקראינ":"UA",
    "מולדוב":"MD",
    "תאיל":   "TH",
    "פיליפ":  "PH",
    "הודו":   "IN",  "הודי":  "IN", "הודים":  "IN",
    "אוזבק":  "UZ",
    "רומנ":   "RO",
    "סרי לנק":"LK", "לנקי":  "LK",
}

# Codes from worker_db.regions.code
REGION_KEYWORDS: dict[str, str] = {
    "מרכז":     "center",
    "צפון":     "north",
    "דרום":     "south",
    "ירושלים":  "jerusalem",
    "כל הארץ":  "national",
}

HOUSING_KEYWORDS = ("לינה", "דיור", "מקום ל", "מגורים", "דירה")

# S1 — truth sets for LLM output validation. Keys the model returns
# that aren't in these sets get dropped to None (with a log line) so
# they never reach the SQL WHERE. Sourced from the same *_KEYWORDS
# maps above so this stays in sync automatically — if we add a
# profession/origin/region keyword, the enum set grows with it.
# The alternative (querying `worker_db.profession_types.code` etc. on
# service boot) is preferable long-term but adds a DB dependency on
# module import; keeping the values in-code matches how the fake
# rewriter already does the extraction.
VALID_PROFESSION_CODES: frozenset[str] = frozenset(PROFESSION_KEYWORDS.values())
VALID_ORIGIN_COUNTRIES: frozenset[str] = frozenset(ORIGIN_KEYWORDS.values())
VALID_REGIONS:          frozenset[str] = frozenset(REGION_KEYWORDS.values())
VALID_AD_TYPES:         frozenset[str] = frozenset(("worker", "housing"))

# Whitelist of the 6 keys we ship back. Anything the LLM invents on
# top gets stripped before the filter dict reaches search.py — a
# hallucinated `experience_years` won't quietly become a filter later
# just because someone adds it to the SELECT.
ALLOWED_OUTPUT_KEYS: frozenset[str] = frozenset((
    "ad_type", "profession_code", "origin_country", "region", "quantity", "canonical_query",
))


def _quantity(text: str) -> Optional[int]:
    """S3 — extract quantity only when the number modifies a count noun,
    OR when it sits at the very start of the query.

    Previously any digit ran anywhere in the string became the filter
    (`"פועלים ל-3 חודשים"` → quantity=3, `"רתך עם 10 שנות ניסיון"`
    → quantity=10), silently narrowing search results on natural queries.
    """
    text = text.strip()
    # Leading-integer form: "20 פועלים" / "15 עובדים למרכז".
    m = re.match(r"^\s*(\d{1,4})\b", text)
    if m:
        return int(m.group(1))
    # Number immediately followed by a count noun. The nouns cover both
    # people (עובדים/פועלים/…) and housing units (מיטות/חדרים) since
    # both search paths use `quantity` for capacity gating.
    count_noun = r"(?:עובדים|פועלים|איש|אנשים|מיטות|חדרים)"
    m = re.search(rf"(\d{{1,4}})[\s -]*{count_noun}\b", text)
    if m:
        return int(m.group(1))
    return None


def _first_match(text: str, table: dict[str, str]) -> Optional[str]:
    for k, v in table.items():
        if k in text:
            return v
    return None


def _ad_type(text: str) -> str:
    if any(w in text for w in HOUSING_KEYWORDS):
        return "housing"
    return "worker"


# ─── Fake mode ─────────────────────────────────────────────────────────────

def rewrite_fake(query: str) -> dict:
    text = query.strip()
    ad_type        = _ad_type(text)
    quantity       = _quantity(text)
    profession     = _first_match(text, PROFESSION_KEYWORDS) if ad_type == "worker" else None
    origin_country = _first_match(text, ORIGIN_KEYWORDS)
    region         = _first_match(text, REGION_KEYWORDS)
    return {
        "ad_type":        ad_type,
        "profession_code": profession,
        "origin_country": origin_country,
        "region":         region,
        "quantity":       quantity,
        "canonical_query": text,
    }


# ─── Redis cache ────────────────────────────────────────────────────────────

_redis = None
def _redis_client():
    global _redis
    if _redis is not None:
        return _redis
    try:
        import redis
        url = os.getenv("REDIS_URL", "redis://redis:6379")
        _redis = redis.from_url(url, decode_responses=True, socket_timeout=1.0)
        _redis.ping()
    except Exception:
        _redis = False  # sentinel — never retry within this process
    return _redis or None


def _cache_key(prefix: str, query: str) -> str:
    h = hashlib.sha256(query.strip().encode("utf-8")).hexdigest()[:24]
    return f"{prefix}:{h}"


# ─── Real mode ──────────────────────────────────────────────────────────────

ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")


def _extract_json(text: str) -> Optional[dict]:
    """Parse a JSON object out of an LLM response — strips ```json fences
    and stray prose. Returns None if we can't find a valid object."""
    if not text:
        return None
    # Strip common ```json ... ``` fences
    stripped = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.IGNORECASE)
    stripped = re.sub(r"\s*```$", "", stripped)
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass
    # Fall back to grabbing the outermost {...} block
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def _validate_enums(d: dict, query: str) -> dict:
    """S1 — enforce that every enum-typed field the LLM returned is a
    real code the DB knows about. Anything else → None + log line, so
    the filter is dropped (not fabricated) and the search shows the
    full set instead of silently going to zero rows.
    Follows the pattern already used in query_reranker.py::_extract_id_list.
    """
    def _check(field: str, valid: frozenset[str]) -> None:
        val = d.get(field)
        if val is None:
            return
        if val not in valid:
            print(f"[qrewrite] enum_reject field={field} value={val!r} query={query[:60]!r}")
            d[field] = None

    _check("ad_type",         VALID_AD_TYPES)
    _check("profession_code", VALID_PROFESSION_CODES)
    _check("origin_country",  VALID_ORIGIN_COUNTRIES)
    _check("region",          VALID_REGIONS)

    # If ad_type got rejected there's no sensible fallback — pin to
    # 'worker' (the dominant path) so downstream doesn't NPE.
    if d.get("ad_type") is None:
        d["ad_type"] = "worker"

    # quantity — coerce and range-check.
    q = d.get("quantity")
    if q is not None:
        try:
            q_int = int(q)
        except (TypeError, ValueError):
            print(f"[qrewrite] enum_reject field=quantity value={q!r} query={query[:60]!r}")
            d["quantity"] = None
        else:
            if q_int <= 0 or q_int > 9999:
                print(f"[qrewrite] enum_reject field=quantity value={q_int!r} query={query[:60]!r}")
                d["quantity"] = None
            else:
                d["quantity"] = q_int

    # Strip any keys the LLM invented that aren't in the contract —
    # keeps hallucinated fields from ever becoming an implicit filter.
    for extra in list(d.keys()):
        if extra not in ALLOWED_OUTPUT_KEYS:
            del d[extra]

    return d


def rewrite_real(query: str) -> dict:
    """Anthropic Claude Haiku call. Redis-cached (5min). Silently falls
    back to fake mode on any error — search must never break on LLM
    outage."""
    r = _redis_client()
    cache_key = _cache_key("qrewrite", query)
    if r:
        try:
            cached = r.get(cache_key)
            if cached:
                return json.loads(cached)
        except Exception:
            pass

    try:
        from anthropic import Anthropic
    except ImportError:
        print("[qrewrite] anthropic sdk missing — falling back to fake")
        return rewrite_fake(query)

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return rewrite_fake(query)

    # L3 — bounded per-request timeout. Anthropic SDK's default is long
    # enough to freeze the search under a degraded upstream; 3s keeps
    # the /search endpoint responsive during outages.
    client = Anthropic(api_key=api_key, timeout=LLM_TIMEOUT_S)
    system = (
        "You translate a Hebrew construction-marketplace query into a structured filter. "
        "Return ONLY a JSON object with keys: "
        "ad_type ('worker'|'housing'), "
        "profession_code (one of flooring, electrician, painting, plumbing, plastering, "
        "formwork, mason, skeleton, scaffolding, general — or null), "
        "origin_country (ISO-2 from: CN, IN, LK, MD, PH, RO, TH, UA, UZ — or null), "
        "region (one of center, north, south, jerusalem, national — or null), "
        "quantity (integer or null), "
        "canonical_query (the user's request, lightly normalised). "
        "Output ONLY the JSON object — no prose, no markdown fences, no code blocks."
    )
    t0 = time.perf_counter()
    try:
        resp = client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=300,
            system=system,
            messages=[{"role": "user", "content": query}],
        )
        elapsed = time.perf_counter() - t0
        text = resp.content[0].text
        parsed = _extract_json(text)
        if not parsed or not isinstance(parsed, dict):
            print(f"[qrewrite] llm_unparseable ({elapsed:.2f}s) → fallback")
            return rewrite_fake(query)

        # Normalise shape — the LLM might miss a field or two.
        fake = rewrite_fake(query)
        merged = {**fake, **{k: v for k, v in parsed.items() if v is not None}}
        # S1 — validate every enum-typed field against the real code
        # sets. Invented values ('laborer', 'CHN', 'merkaz') would
        # otherwise slip past the string prompt guard and reach the
        # SQL WHERE, silently filtering the whole search to zero rows.
        # Rejected values fall to None (not to fake's guess — merge
        # already carried fake's value in, so an LLM-produced garbage
        # value should mean "no filter", not "use the extractor's
        # guess") so an unrecognised code disables the filter cleanly.
        merged = _validate_enums(merged, query)

        if elapsed > LLM_SLOW_THRESHOLD_S:
            print(f"[qrewrite] slow ({elapsed:.2f}s) query='{query[:60]}'")

        if r:
            try:
                r.setex(cache_key, CACHE_TTL_S, json.dumps(merged, ensure_ascii=False))
            except Exception:
                pass
        return merged
    except Exception as exc:  # noqa: BLE001 — search must never break on LLM outage
        elapsed = time.perf_counter() - t0
        # Classify so we can grep the log:
        #   timeout        — Anthropic took >LLM_TIMEOUT_S
        #   rate_limit     — 429 from upstream
        #   auth           — 401 (bad key)
        #   other          — everything else
        msg = str(exc).lower()
        if "timeout" in msg or "timed out" in msg:
            kind = "timeout"
        elif "429" in msg or "rate" in msg:
            kind = "rate_limit"
        elif "401" in msg or "auth" in msg:
            kind = "auth"
        else:
            kind = "other"
        print(f"[qrewrite] fallback:{kind} ({elapsed:.2f}s) — {type(exc).__name__}")
        return rewrite_fake(query)


def rewrite(query: str) -> dict:
    if FAKE_MODE:
        return rewrite_fake(query)
    return rewrite_real(query)


# S2 — one-line startup banner. Grep the user-org container logs for
# "[qrewrite] mode=" to see which path the service actually took.
if FAKE_MODE:
    _reason = "explicit_env" if _FAKE_MODE_EXPLICIT == "1" else "no_api_key"
    print(f"[qrewrite] mode=fake reason={_reason}")
else:
    print(f"[qrewrite] mode=real model={ANTHROPIC_MODEL} timeout={LLM_TIMEOUT_S}s")
