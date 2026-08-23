"""Pivot/v2 Phase 3 — free-text search over ads.

Public endpoint: anyone (even non-logged-in) can search and see ads.
Subscription is required only to REVEAL the corp's contact info — that
lives on /api/ads/{id}/contact-reveal in ads.py.

Pipeline:
  1. query_rewriter.rewrite(query) → structured filters
  2. SQL SELECT against ads with NULL-permissive filtering
     (NULL field on the ad = "willing to consider any")
  3. featured_until ranks first, then published_at desc
  4. Rerank via LLM (phase 5).
  5. NM — second pass: if the exact query returned < 3 rows AND the
     rewriter extracted a relax-eligible filter, drop that filter and
     rerun to surface near_matches. Client renders them separately
     with copy naming the specific dimension relaxed + the actual
     alternates observed. Prevents the "empty page teaches nothing"
     failure mode (e.g. "רצפים סינים" hiding a perfectly good
     `flooring + UA` row that the contractor would have taken).

Contact info (corp's phone/email) is NEVER returned by /search — the
results are anonymised and the frontend asks for contact reveal per
ad, behind the subscription gate. That contract applies identically
to results AND near_matches.
"""
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.db import get_db
from app.services.query_rewriter import rewrite
from app.services.query_reranker import rerank

router = APIRouter()

RESULT_LIMIT = 50

# NM — trigger the second pass only when the exact result set is thin.
# 3 is the point where the contractor stops feeling "I got a match" and
# starts feeling "there's nothing here" — that's where a good near-
# match saves the intent.
NEAR_MATCH_TRIGGER = 3
NEAR_MATCH_LIMIT   = 10

# NM — order matters. We relax at most ONE filter per second pass and
# try filters in this priority. profession_code + ad_type are the
# user's INTENT — never relaxed. quantity is a preference (they'd
# combine 2 corps rather than lose the match); origin is a
# preference-not-a-requirement in construction (Chinese vs Romanian
# floorers do the same work); region is willing-to-flex geography.
NM_RELAX_ORDER = ("quantity", "origin_country", "region")
NM_MAX_ATTEMPTS = 2  # if the first relax returns 0 new rows, try the next


class SearchIn(BaseModel):
    query: str = Field(..., min_length=2, max_length=500)


def _serialize_ad(row: dict) -> dict:
    # Strip contact-sensitive fields. Owner id is kept so the frontend
    # can call /ads/{id}/contact-reveal once the contractor decides
    # to reach out (subscription gate fires there).
    out = {
        "id":               row["id"],
        "owner_entity_id":  row["owner_entity_id"],
        "ad_type":          row["ad_type"],
        "title_he":         row["title_he"],
        "body_he":          row["body_he"],
        "region":           row["region"],
        "featured_until":   row["featured_until"].isoformat() if row.get("featured_until") else None,
        "published_at":     row["published_at"].isoformat() if row.get("published_at") else None,
        "expires_at":       row["expires_at"].isoformat()   if row.get("expires_at")   else None,
    }
    if row["ad_type"] == "worker":
        out.update({
            "profession_code":       row["profession_code"],
            "origin_country":        row["origin_country"],
            "quantity":              row["quantity"],
            "experience_min_months": row["experience_min_months"],
            "visa_valid_until":      row["visa_valid_until"].isoformat() if row.get("visa_valid_until") else None,
            "languages":             row.get("languages"),
        })
    else:  # housing
        out.update({
            "city":              row["city"],
            "address_he":        row["address_he"],
            "total_beds":        row["total_beds"],
            "available_beds":    row["available_beds"],
            "price_per_bed_nis": row["price_per_bed_nis"],
            "amenities":         row.get("amenities"),
            "photos":            row.get("photos"),
        })
    return out


def _build_where(filters: dict, drop_field: Optional[str] = None) -> tuple[list[str], list[object]]:
    """Build the WHERE clause + bind params for the search query.

    `drop_field` (NM): when set, skip that filter — the caller wants to
    see what shows up if this constraint is removed. profession_code
    and ad_type are still applied even when named as drop_field (the
    caller shouldn't ask for those; enforced separately in the caller).
    """
    wheres = [
        "a.ad_type = %s",
        "a.active = TRUE",
        "a.deleted_at IS NULL",
        "(a.expires_at IS NULL OR a.expires_at > NOW())",
    ]
    params: list[object] = [filters["ad_type"]]

    if filters.get("profession_code"):
        wheres.append("(a.profession_code IS NULL OR a.profession_code = %s)")
        params.append(filters["profession_code"])
    if filters.get("origin_country") and drop_field != "origin_country":
        wheres.append("(a.origin_country IS NULL OR a.origin_country = %s)")
        params.append(filters["origin_country"])
    if filters.get("region") and drop_field != "region":
        wheres.append("(a.region IS NULL OR a.region = %s)")
        params.append(filters["region"])
    if filters.get("quantity") and drop_field != "quantity":
        # For worker ads the contractor's requested count is compared
        # against the corp's offered quantity; for housing it maps to
        # available_beds (contractor needs somewhere for N workers to sleep).
        if filters["ad_type"] == "housing":
            wheres.append("(a.available_beds IS NULL OR a.available_beds >= %s)")
        else:
            wheres.append("(a.quantity IS NULL OR a.quantity >= %s)")
        params.append(filters["quantity"])
    return wheres, params


def _order_clause(relaxed_field: Optional[str], ad_type: str) -> str:
    """NM — when quantity is relaxed, sort by closest-to-target
    (largest first) so the top of the near_matches list is the most
    useful stack for the contractor. All other relaxations use the
    default boosted-first + recency order."""
    if relaxed_field == "quantity":
        qty_col = "available_beds" if ad_type == "housing" else "quantity"
        return f"{qty_col} DESC, a.published_at DESC"
    return (
        "(a.featured_until IS NOT NULL AND a.featured_until > NOW()) DESC, "
        "a.featured_until DESC, "
        "a.published_at  DESC"
    )


@router.post("")
def search(body: SearchIn):
    filters = rewrite(body.query)

    # -- Pass 1: exact ---------------------------------------------------
    exact_wheres, exact_params = _build_where(filters)
    exact_sql = f"""
        SELECT a.*
          FROM ads a
         WHERE {' AND '.join(exact_wheres)}
         ORDER BY {_order_clause(None, filters['ad_type'])}
         LIMIT {RESULT_LIMIT}
    """

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(exact_sql, exact_params)
        exact_rows = cur.fetchall()

        # -- Pass 2 (NM): only when exact is thin ------------------------
        # Rules:
        #   * relax ONE filter at a time — never combine
        #   * try filters in NM_RELAX_ORDER, skipping ones the query
        #     didn't specify (relaxing a filter that isn't there is a
        #     no-op that just re-runs the exact query)
        #   * up to NM_MAX_ATTEMPTS relaxations if the first returns 0
        #     new rows (an already-empty near set is worthless)
        #   * profession_code + ad_type are never relaxed — those are
        #     the intent itself (see NM_RELAX_ORDER)
        near_rows: list[dict] = []
        relaxed_field: Optional[str] = None
        if len(exact_rows) < NEAR_MATCH_TRIGGER:
            exact_ids = {r["id"] for r in exact_rows}
            attempts = 0
            for candidate in NM_RELAX_ORDER:
                if attempts >= NM_MAX_ATTEMPTS:
                    break
                if not filters.get(candidate):
                    # Filter wasn't extracted from the query — nothing
                    # to relax. Skip without spending an attempt.
                    continue
                attempts += 1
                near_wheres, near_params = _build_where(filters, drop_field=candidate)
                near_sql = f"""
                    SELECT a.*
                      FROM ads a
                     WHERE {' AND '.join(near_wheres)}
                     ORDER BY {_order_clause(candidate, filters['ad_type'])}
                     LIMIT {NEAR_MATCH_LIMIT + RESULT_LIMIT}
                """
                cur.execute(near_sql, near_params)
                candidate_rows = [r for r in cur.fetchall() if r["id"] not in exact_ids]
                if candidate_rows:
                    near_rows = candidate_rows[:NEAR_MATCH_LIMIT]
                    relaxed_field = candidate
                    break
    finally:
        conn.close()

    # Rerank only exact results — near_matches are already sorted by
    # the closest-to-target dimension (quantity DESC or the default
    # boosted+recency); running them through the LLM reranker would
    # cost real money to produce a worse order for a suggestive list.
    serialised_exact = [_serialize_ad(r) for r in exact_rows]
    reranked         = rerank(body.query, serialised_exact)
    serialised_near  = [_serialize_ad(r) for r in near_rows]

    return {
        "filters":      filters,
        "results":      reranked,
        "total":        len(reranked),
        "near_matches": serialised_near,
        "relaxed":      relaxed_field,
    }
