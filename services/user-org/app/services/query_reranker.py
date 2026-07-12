"""Pivot/v2 Phase 5 — LLM-based rerank over SQL-prefiltered candidates.

Cheaper alternative to full vector RAG (Q1c decision): after the SQL
prefilter narrows down to a candidate set, we send the query + a compact
summary of the top-N candidates to Claude Haiku and ask for a relevance-
ordered list of ad IDs. Reranking only fires when there are enough
candidates to make it worthwhile (>= RERANK_MIN).

Failure modes are silent — the returned list is the input list on any
error. Search must never break because of a rerank hiccup.
"""
import hashlib
import json
import os
import re
from typing import Optional

RERANK_ENABLED = os.getenv("LLM_RERANK_ENABLED", "1") == "1"
RERANK_MIN     = int(os.getenv("LLM_RERANK_MIN", "5"))
RERANK_TOP_N   = int(os.getenv("LLM_RERANK_TOP_N", "30"))
CACHE_TTL_S    = int(os.getenv("LLM_RERANK_CACHE_TTL", "300"))

ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")


def _redis_client():
    try:
        import redis
        url = os.getenv("REDIS_URL", "redis://redis:6379")
        r = redis.from_url(url, decode_responses=True, socket_timeout=1.0)
        r.ping()
        return r
    except Exception:
        return None


def _cache_key(query: str, ad_ids: list[str]) -> str:
    signature = query.strip() + "|" + ",".join(sorted(ad_ids))
    h = hashlib.sha256(signature.encode("utf-8")).hexdigest()[:24]
    return f"qrerank:{h}"


def _summarise(ad: dict) -> str:
    """Compact one-line summary of an ad — kept short so we stay under
    the model's token budget even with 30 candidates."""
    parts: list[str] = []
    title = (ad.get("title_he") or "").strip()
    if title:
        parts.append(title[:140])
    if ad.get("ad_type") == "worker":
        for k, label in (("profession_code", "מקצוע"), ("origin_country", "מוצא"),
                         ("region", "אזור"), ("quantity", "כמות")):
            v = ad.get(k)
            if v:
                parts.append(f"{label}={v}")
    else:  # housing
        for k, label in (("city", "עיר"), ("region", "אזור"),
                         ("available_beds", "מיטות"), ("price_per_bed_nis", "מחיר/מיטה")):
            v = ad.get(k)
            if v:
                parts.append(f"{label}={v}")
    body = (ad.get("body_he") or "").strip()
    if body:
        parts.append("· " + body[:180])
    return " ".join(parts)


def _extract_id_list(text: str, valid_ids: set[str]) -> list[str]:
    """Parse a JSON array of IDs from an LLM response and drop anything
    that isn't in the candidate set — the model sometimes hallucinates
    UUIDs on the retry path."""
    if not text:
        return []
    stripped = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.IGNORECASE)
    stripped = re.sub(r"\s*```$", "", stripped)
    try:
        data = json.loads(stripped)
    except json.JSONDecodeError:
        m = re.search(r"\[[\s\S]*\]", text)
        if not m:
            return []
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError:
            return []
    if not isinstance(data, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in data:
        s = str(item).strip()
        if s in valid_ids and s not in seen:
            out.append(s)
            seen.add(s)
    return out


def rerank(query: str, candidates: list[dict]) -> list[dict]:
    """Rerank candidates by LLM relevance. Returns candidates unchanged
    on skip or any failure."""
    if not RERANK_ENABLED:
        return candidates
    if len(candidates) < RERANK_MIN:
        return candidates
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return candidates

    # Only send top N by SQL order (which already ranks featured first).
    top = candidates[:RERANK_TOP_N]
    tail = candidates[RERANK_TOP_N:]
    valid_ids = {c["id"] for c in top}
    ad_ids_sorted = [c["id"] for c in top]

    # Redis cache — same (query + candidate set) → same order.
    r = _redis_client()
    ck = _cache_key(query, ad_ids_sorted)
    if r:
        try:
            cached = r.get(ck)
            if cached:
                order = json.loads(cached)
                return _reorder(candidates, order)
        except Exception:
            pass

    try:
        from anthropic import Anthropic
    except ImportError:
        return candidates

    lines = [f"{c['id']}: {_summarise(c)}" for c in top]
    prompt = (
        "Query (Hebrew, construction marketplace):\n"
        f"{query}\n\n"
        "Candidates (id: summary):\n" + "\n".join(lines) + "\n\n"
        "Return ONLY a JSON array of ad ids, ordered by relevance to the query "
        "(most relevant first). Include every id exactly once — no additions, "
        "no omissions. No prose."
    )

    try:
        client = Anthropic(api_key=api_key)
        resp = client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=1200,
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.content[0].text
        ranked = _extract_id_list(text, valid_ids)
        if not ranked:
            return candidates

        # Append any candidates the LLM dropped, in their original order —
        # never lose a result to a partial response.
        remaining = [c["id"] for c in top if c["id"] not in set(ranked)]
        final_order = ranked + remaining

        if r:
            try:
                r.setex(ck, CACHE_TTL_S, json.dumps(final_order))
            except Exception:
                pass

        return _reorder(top, final_order) + tail
    except Exception:
        return candidates


def _reorder(candidates: list[dict], order: list[str]) -> list[dict]:
    by_id = {c["id"]: c for c in candidates}
    out = [by_id[i] for i in order if i in by_id]
    # Any candidate not covered by `order` stays where it was.
    covered = set(order)
    for c in candidates:
        if c["id"] not in covered:
            out.append(c)
    return out
