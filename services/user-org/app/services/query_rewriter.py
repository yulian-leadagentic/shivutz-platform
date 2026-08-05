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
import time
from typing import Optional

FAKE_MODE = os.getenv("LLM_REWRITER_FAKE_MODE", "1") == "1"
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
        # Guardrail: ad_type must be one of the two values.
        if merged.get("ad_type") not in ("worker", "housing"):
            merged["ad_type"] = fake["ad_type"]

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
