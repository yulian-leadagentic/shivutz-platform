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
import json
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.db import get_db
from app.services.query_rewriter import rewrite
from app.services.query_reranker import rerank
from app.services.visibility import (
    contractor_approval_status,
    require_contractor_approved,  # noqa: F401 · re-exported for other routes
    viewer_scope_wheres,
)
from app.services.search_normalize import normalize_search_term

router = APIRouter()

RESULT_LIMIT = 50

# U6 §2 — federated marketplace pass. Cap kept modest: `/marketplace`
# is the destination when a user actually wants to browse services;
# the landing search is "did we find any related service" so 20 is
# more than enough for the section preview.
MARKETPLACE_LIMIT = 20

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
    # L3 §2.1 — trust_level is a server-derived signal (verified /
    # registered / unverified) computed via a JOIN on corporations in
    # the search SQL below. NEVER add corp_name here — Yulian 10.09:
    # the name is the product /contact-reveal sells; leaking it in
    # results would sell it for free.
    out = {
        "id":               row["id"],
        "owner_entity_id":  row["owner_entity_id"],
        "ad_type":          row["ad_type"],
        "title_he":         row["title_he"],
        "body_he":          row["body_he"],
        "region":           row["region"],
        "trust_level":      row.get("trust_level") or "unverified",
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


def _build_where(
    filters: dict,
    drop_field: Optional[str] = None,
    scope_extra: Optional[tuple[list[str], list[object]]] = None,
) -> tuple[list[str], list[object]]:
    """Build the WHERE clause + bind params for the search query.

    `drop_field` (NM): when set, skip that filter — the caller wants to
    see what shows up if this constraint is removed. profession_code
    and ad_type are still applied even when named as drop_field (the
    caller shouldn't ask for those; enforced separately in the caller).

    `scope_extra` (H12 · U3): additional (wheres, params) from
    `services.visibility.viewer_scope_wheres` — for a corp caller this
    restricts worker-ad rows to that corp's own inventory. Housing
    stays shared. Contractors + anon + admins get an empty scope.
    Kept as an opaque pair so the visibility rule lives in ONE place;
    do not inline the SQL fragment here.
    """
    wheres = [
        "a.ad_type = %s",
        "a.active = TRUE",
        "a.deleted_at IS NULL",
        "(a.expires_at IS NULL OR a.expires_at > NOW())",
    ]
    params: list[object] = [filters["ad_type"]]

    if scope_extra:
        extra_wheres, extra_params = scope_extra
        wheres.extend(extra_wheres)
        params.extend(extra_params)

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


# ═══ U6 §2 · federated marketplace pass ════════════════════════════════════
#
# The `ads` pipeline above runs through query_rewriter → SQL over the
# ads table. `marketplace_listings` is a completely separate table
# with a completely different domain (housing rentals, transport,
# insurance, courses — anything a contractor might need besides raw
# manpower).
#
# Before U6 the landing search only hit `ads`. A query like "קורס עברית"
# fell into query_rewriter's ad_type default (`worker`) and returned six
# workers from China — a confidently wrong answer to a question the
# ads table cannot answer. Root cause was VALID_AD_TYPES = {worker,
# housing} in query_rewriter.py — but per the guardrail we do NOT
# touch that file; instead we ADD a parallel branch over
# marketplace_listings and let the frontend show two labelled
# sections.
#
# The two branches never merge into one list — they have different
# reveal models (workers are behind /contact-reveal + subscription
# metering; marketplace has its own paywall on /marketplace/{id})
# and different card layouts. Keeping the sections separate is the
# whole point.


def _serialize_marketplace_listing(row: dict) -> dict:
    """Slim projection matching the MarketplaceListing type on the
    frontend. Contact_phone / contact_name deliberately omitted — the
    marketplace has its own reveal endpoint on /api/marketplace and
    the landing preview doesn't need to know it."""
    return {
        "id":              row["id"],
        "corporation_id":  row["corporation_id"],
        "corporation_name": row.get("corporation_name_he") or row.get("corporation_name_en"),
        "is_corporation_verified": bool(row.get("corp_verified_at")),
        "category":        row["category"],
        "subcategory":     row.get("subcategory"),
        "title":           row["title"],
        "description":     row.get("description"),
        "city":            row.get("city"),
        "region":          row.get("region"),
        "price":           row.get("price"),
        "price_unit":      row.get("price_unit"),
        "capacity":        row.get("capacity"),
        "images_json":     json.loads(row["images_json"]) if row.get("images_json") else None,
        "status":          row["status"],
        "created_at":      row["created_at"].isoformat() if row.get("created_at") else None,
        "updated_at":      row["updated_at"].isoformat() if row.get("updated_at") else None,
    }


def _search_marketplace(raw_query: str) -> list[dict]:
    """Federated marketplace-listings pass — U6 §2. Uses the SAME
    `normalize_search_term` as /api/marketplace so `ביטוח,` and
    `ביטוח` return identical rows. Multi-word queries AND their
    per-token LIKEs. Rows sorted newest-first; the marketplace has
    no `featured_until` / boost model to promote."""
    _, tokens = normalize_search_term(raw_query)
    if not tokens:
        return []

    conditions = ["ml.status = 'active'"]
    params: list[object] = []
    per_token: list[str] = []
    for tok in tokens:
        per_token.append(
            "(ml.title LIKE %s ESCAPE '\\\\' "
            "OR ml.description LIKE %s ESCAPE '\\\\' "
            "OR ml.city LIKE %s ESCAPE '\\\\')"
        )
        params.extend([tok, tok, tok])
    conditions.append("(" + " AND ".join(per_token) + ")")

    sql = f"""
        SELECT ml.*,
               c.company_name_he AS corporation_name_he,
               c.company_name    AS corporation_name_en,
               c.gov_registry_matched_at AS corp_verified_at
          FROM marketplace_listings ml
          LEFT JOIN corporations c ON c.id = ml.corporation_id
         WHERE {' AND '.join(conditions)}
         ORDER BY ml.created_at DESC
         LIMIT {MARKETPLACE_LIMIT}
    """
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        return [_serialize_marketplace_listing(r) for r in cur.fetchall()]
    finally:
        conn.close()


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
def search(
    body: SearchIn,
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
    x_user_role:   Optional[str] = Header(default=None),
):
    # R13 §2d — search is open to every caller (anon included; the
    # gateway now lists /api/search in PUBLIC_PREFIXES). What varies
    # by caller is the SQL scope on the ads table, not the endpoint
    # gate. `viewer_scope_wheres` returns 1=0 for anon (worker +
    # housing blocked), an ownership predicate for corp, ad_type<>
    # 'worker' for provider, and an empty scope for contractor + admin.
    # A pending contractor gets a second 1=0 appended below so the
    # scope path matches the L2 gate other read paths still enforce
    # via `require_contractor_approved`. Marketplace runs on its own
    # rules (no scope arg) so every caller keeps seeing services.

    filters = rewrite(body.query)

    scope_extra = viewer_scope_wheres(x_entity_id, x_entity_type, x_user_role)

    # R13 §2d · a contractor whose approval hasn't landed sees
    # marketplace only. Mirror the L2 rule that the four sibling
    # public feeds still enforce as a 403 in `require_contractor_approved`
    # — same scoping outcome, delivered as a scoped 200 so the FE
    # can render the "החשבון שלך עדיין בבדיקה" copy in the workers
    # section instead of a red banner. `viewer_approval_status`
    # rides in the response so the FE can pick the right empty-state
    # copy without a second round-trip.
    viewer_approval_status: Optional[str] = None
    if x_entity_type == "contractor" and x_entity_id:
        viewer_approval_status = contractor_approval_status(x_entity_id)
        if viewer_approval_status != "approved":
            wheres, params = scope_extra
            scope_extra = (list(wheres) + ["1=0"], list(params))

    # -- Pass 1: exact ---------------------------------------------------
    exact_wheres, exact_params = _build_where(filters, scope_extra=scope_extra)
    # L3 §2.1 — LEFT JOIN corporations to derive trust_level per row.
    # Collation cast is required: ads.owner_entity_id is utf8mb4_0900_ai_ci,
    # corporations.id is legacy utf8mb4_unicode_ci — same pattern as
    # ads.py:796. LEFT (not INNER) so a row whose corp was hard-deleted
    # still surfaces with trust_level='unverified' rather than
    # disappearing from results.
    exact_sql = f"""
        SELECT a.*,
               CASE
                 WHEN c.gov_registry_matched_at IS NOT NULL
                      AND c.approval_status = 'approved' THEN 'verified'
                 WHEN c.approval_status = 'approved'      THEN 'registered'
                 ELSE 'unverified'
               END AS trust_level
          FROM ads a
          LEFT JOIN corporations c
            ON c.id COLLATE utf8mb4_0900_ai_ci = a.owner_entity_id
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
                near_wheres, near_params = _build_where(
                    filters, drop_field=candidate,
                    scope_extra=scope_extra,
                )
                # L3 §2.1 — same trust_level JOIN as the exact pass.
                near_sql = f"""
                    SELECT a.*,
                           CASE
                             WHEN c.gov_registry_matched_at IS NOT NULL
                                  AND c.approval_status = 'approved' THEN 'verified'
                             WHEN c.approval_status = 'approved'      THEN 'registered'
                             ELSE 'unverified'
                           END AS trust_level
                      FROM ads a
                      LEFT JOIN corporations c
                        ON c.id COLLATE utf8mb4_0900_ai_ci = a.owner_entity_id
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

    # U6 §2 — federated marketplace pass. Runs ALWAYS, on the raw
    # query text (query_rewriter's structured output is meaningless
    # for services). Empty-list is returned when nothing matches —
    # the frontend suppresses the section on empty rather than
    # rendering a hollow heading.
    marketplace_matches = _search_marketplace(body.query)

    # U6 §2 — section ordering. Two rules from the spec:
    #   * profession_code extracted → workers is the intent → 'ads' first.
    #   * nothing extracted BUT marketplace has hits AND ads came up
    #     empty → 'marketplace' first (the marketplace answer is the
    #     only real answer we can give).
    # Ambiguous cases (both non-empty, no profession) still show ads
    # first: the ads pipeline runs through the LLM reranker which
    # already scored the query's intent; marketplace is the surprise
    # bonus, not the headline.
    marketplace_first = (
        not filters.get("profession_code")
        and not reranked
        and bool(marketplace_matches)
    )
    primary_section = "marketplace" if marketplace_first else "ads"

    return {
        "filters":                 filters,
        "results":                 reranked,
        "total":                   len(reranked),
        "near_matches":            serialised_near,
        "relaxed":                 relaxed_field,
        "marketplace_matches":     marketplace_matches,
        "primary_section":         primary_section,
        # R13 §2d · lets the FE pick the workers-block empty-state
        # copy (approved amber vs "החשבון שלך עדיין בבדיקה") without
        # a second round-trip. None for non-contractor callers.
        "viewer_approval_status":  viewer_approval_status,
    }
