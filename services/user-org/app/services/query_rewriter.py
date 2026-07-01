"""Pivot/v2 Phase 3 — free-text → structured query.

Two modes, switched by env var LLM_REWRITER_FAKE_MODE:
  fake (default) — regex/keyword extractor. No external dependency.
  real           — Anthropic Claude Haiku call. Requires ANTHROPIC_API_KEY.

Fake mode is good enough for Hebrew test queries like
"מחפש 4 פועלים סינים לריצוף" or "מחפש מקום לינה ל-4 פועלים מסין באזור המרכז".
Phase 5 layers vector rerank on top; this stays as the prefilter.

The map dictionaries here are intentionally small + local. As we see
real-world queries, expand them (or flip to real LLM mode for
robustness).
"""
import os
import re
from typing import Optional

FAKE_MODE = os.getenv("LLM_REWRITER_FAKE_MODE", "1") == "1"

# Profession keyword → code. Match by substring (Hebrew morphology is
# rich, so partial matches catch noun/verb forms). Codes are the values
# already in worker_db.professions.code.
PROFESSION_KEYWORDS: dict[str, str] = {
    "ריצוף": "TILER",      "רצף":   "TILER",      "רצפים": "TILER",
    "ריתוך": "WELDER",     "רתך":   "WELDER",     "רתכים": "WELDER",
    "חשמל":  "ELECTRICIAN","חשמלאי":"ELECTRICIAN","חשמלאים":"ELECTRICIAN",
    "צבע":   "PAINTER",    "צבעי":  "PAINTER",    "צבעים": "PAINTER",
    "אינסטל":"PLUMBER",    "אינסטלטור":"PLUMBER", "שרברב": "PLUMBER",
    "טייח":  "PLASTERER",  "טיוח":  "PLASTERER",
    "נגר":   "CARPENTER",  "נגרים": "CARPENTER",
    "ברזל":  "STEELWORKER","ברזלן": "STEELWORKER","ברזלנים":"STEELWORKER",
    "גבס":   "DRYWALL",    "גיבוס": "DRYWALL",
    "בלוקים":"BLOCKLAYER", "בלוקאי":"BLOCKLAYER",
    "פועל":  "GENERAL",    "פועלים":"GENERAL",
}

# Origin keyword → ISO-2 code. Singular + plural / nationalized form.
ORIGIN_KEYWORDS: dict[str, str] = {
    "סין":   "CN", "סיני":  "CN", "סינים":  "CN", "סינית": "CN",
    "אוקראינ":"UA",                 # אוקראינים / אוקראיני / אוקראינה
    "מולדוב":"MD",                  # מולדבים / מולדובה / מולדבי
    "תאיל":   "TH",
    "פיליפ":  "PH",
    "הודו":   "IN",  "הודי":  "IN", "הודים":  "IN",
    "אוזבק":  "UZ",
    "אריתר":  "ER",
    "טורקי":  "TR",
}

# Region keyword → region code (matches org_db.regions).
REGION_KEYWORDS: dict[str, str] = {
    "מרכז":     "CENTER",
    "צפון":     "NORTH",
    "דרום":     "SOUTH",
    "ירושלים":  "JLM",
    "שפלה":     "SHEFELA",
    "שרון":     "SHARON",
}

HOUSING_KEYWORDS = ("לינה", "דיור", "מקום ל", "מגורים", "דירה")


def _quantity(text: str) -> Optional[int]:
    """First integer in the text. '4 פועלים' → 4."""
    m = re.search(r"\d+", text)
    return int(m.group(0)) if m else None


def _first_match(text: str, table: dict[str, str]) -> Optional[str]:
    for k, v in table.items():
        if k in text:
            return v
    return None


def _all_matches(text: str, table: dict[str, str]) -> list[str]:
    seen: list[str] = []
    for k, v in table.items():
        if k in text and v not in seen:
            seen.append(v)
    return seen


def _ad_type(text: str) -> str:
    if any(w in text for w in HOUSING_KEYWORDS):
        return "housing"
    return "worker"


# ─── Fake mode ─────────────────────────────────────────────────────────────

def rewrite_fake(query: str) -> dict:
    """Regex-based extractor — good enough for the demo queries from the
    pivot brief. Returns the same shape the real LLM mode does."""
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
        "canonical_query": text,   # passed through; Phase 5 will use this for embedding
    }


# ─── Real mode (stub — wires up when ANTHROPIC_API_KEY exists) ──────────────

ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"

def rewrite_real(query: str) -> dict:
    """Anthropic Claude Haiku call. Returns the same dict shape as the
    fake mode. Falls back to fake mode if the API call fails so search
    is never completely broken by an LLM outage."""
    try:
        from anthropic import Anthropic
    except ImportError:
        # `anthropic` not installed — silently degrade. Add the package
        # to user-org requirements before flipping LLM_REWRITER_FAKE_MODE=0.
        return rewrite_fake(query)

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return rewrite_fake(query)

    client = Anthropic(api_key=api_key)
    system = (
        "You translate a Hebrew construction-marketplace query into a structured filter. "
        "Return ONLY a JSON object with keys: ad_type ('worker'|'housing'), "
        "profession_code (one of TILER/WELDER/ELECTRICIAN/PAINTER/PLUMBER/PLASTERER/"
        "CARPENTER/STEELWORKER/DRYWALL/BLOCKLAYER/GENERAL or null), "
        "origin_country (ISO-2 like CN/UA/MD/TH/PH/IN/UZ/ER/TR or null), "
        "region (CENTER/NORTH/SOUTH/JLM/SHEFELA/SHARON or null), "
        "quantity (integer or null), canonical_query (the user's request, lightly normalised). "
        "Output ONLY JSON, no prose, no markdown fences."
    )
    try:
        resp = client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=200,
            system=system,
            messages=[{"role": "user", "content": query}],
        )
        import json
        text = resp.content[0].text.strip()
        return json.loads(text)
    except Exception:
        return rewrite_fake(query)


def rewrite(query: str) -> dict:
    if FAKE_MODE:
        return rewrite_fake(query)
    return rewrite_real(query)
