"""Pivot/v2 — free-text → structured query.

Modes:
  fake — regex/keyword extractor. Zero external deps.
  real — Claude Haiku via Anthropic API. Requires ANTHROPIC_API_KEY.

Auto-selection: real mode fires when ANTHROPIC_API_KEY is set AND
LLM_REWRITER_FAKE_MODE is not '1'. Falls back to fake if the API call
raises or returns unparseable JSON — search is never blocked by an LLM
outage.

Real-mode results are cached in Redis for 5 minutes (key = sha256 of
the raw query) so repeated searches don't re-bill.
"""
import hashlib
import json
import os
import re
from typing import Optional

FAKE_MODE = os.getenv("LLM_REWRITER_FAKE_MODE", "1") == "1"
CACHE_TTL_S = int(os.getenv("LLM_REWRITER_CACHE_TTL", "300"))

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

ORIGIN_KEYWORDS: dict[str, str] = {
    "סין":   "CN", "סיני":  "CN", "סינים":  "CN", "סינית": "CN",
    "אוקראינ":"UA",
    "מולדוב":"MD",
    "תאיל":   "TH",
    "פיליפ":  "PH",
    "הודו":   "IN",  "הודי":  "IN", "הודים":  "IN",
    "אוזבק":  "UZ",
    "אריתר":  "ER",
    "טורקי":  "TR",
}

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
    m = re.search(r"\d+", text)
    return int(m.group(0)) if m else None


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
        return rewrite_fake(query)

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return rewrite_fake(query)

    client = Anthropic(api_key=api_key)
    system = (
        "You translate a Hebrew construction-marketplace query into a structured filter. "
        "Return ONLY a JSON object with keys: "
        "ad_type ('worker'|'housing'), "
        "profession_code (one of TILER, WELDER, ELECTRICIAN, PAINTER, PLUMBER, "
        "PLASTERER, CARPENTER, STEELWORKER, DRYWALL, BLOCKLAYER, GENERAL or null), "
        "origin_country (ISO-2 like CN, UA, MD, TH, PH, IN, UZ, ER, TR or null), "
        "region (CENTER, NORTH, SOUTH, JLM, SHEFELA, SHARON or null), "
        "quantity (integer or null), "
        "canonical_query (the user's request, lightly normalised). "
        "Output ONLY the JSON object — no prose, no markdown fences, no code blocks."
    )
    try:
        resp = client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=300,
            system=system,
            messages=[{"role": "user", "content": query}],
        )
        text = resp.content[0].text
        parsed = _extract_json(text)
        if not parsed or not isinstance(parsed, dict):
            return rewrite_fake(query)

        # Normalise shape — the LLM might miss a field or two.
        fake = rewrite_fake(query)
        merged = {**fake, **{k: v for k, v in parsed.items() if v is not None}}
        # Guardrail: ad_type must be one of the two values.
        if merged.get("ad_type") not in ("worker", "housing"):
            merged["ad_type"] = fake["ad_type"]

        if r:
            try:
                r.setex(cache_key, CACHE_TTL_S, json.dumps(merged, ensure_ascii=False))
            except Exception:
                pass
        return merged
    except Exception:
        return rewrite_fake(query)


def rewrite(query: str) -> dict:
    if FAKE_MODE:
        return rewrite_fake(query)
    return rewrite_real(query)
