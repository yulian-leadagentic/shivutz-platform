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
import logging
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.db import get_db
from app.services.query_rewriter import (
    ORIGIN_KEYWORDS,
    PROFESSION_KEYWORDS,
    REGION_KEYWORDS,
    rewrite,
)
from app.services.query_reranker import rerank
from app.services.visibility import (
    contractor_approval_status,
    hidden_types_for_viewer,
    marketplace_scope_wheres,
    require_contractor_approved,  # noqa: F401 · re-exported for other routes
    viewer_scope_wheres,
)
from app.services.search_normalize import (
    marketplace_text_token_clauses,
    normalize_search_term,
)

router = APIRouter()

_log = logging.getLogger(__name__)

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


def _serialize_ad(row: dict, *, viewer_can_see_owner: bool = False) -> dict:
    # Strip contact-sensitive fields. Owner id is gated by
    # `viewer_can_see_owner` per R15 §3d: an approved contractor + admin
    # + the ad's own advertiser can see it (contractor's "my ad"
    # detection depends on the field); anon / pending / provider / a
    # corp browsing a foreign row do NOT.
    # L3 §2.1 — trust_level is a server-derived signal (verified /
    # registered / unverified) computed via a JOIN on corporations in
    # the search SQL below. NEVER add corp_name here — Yulian 10.09:
    # the name is the product /contact-reveal sells; leaking it in
    # results would sell it for free.
    out = {
        "id":               row["id"],
        "ad_type":          row["ad_type"],
        "title_he":         row["title_he"],
        "body_he":          row["body_he"],
        "region":           row["region"],
        "trust_level":      row.get("trust_level") or "unverified",
        "featured_until":   row["featured_until"].isoformat() if row.get("featured_until") else None,
        "published_at":     row["published_at"].isoformat() if row.get("published_at") else None,
        "expires_at":       row["expires_at"].isoformat()   if row.get("expires_at")   else None,
    }
    if viewer_can_see_owner:
        # R15 §3d · gated. Emit only when the caller is entitled
        # (contractor approved, admin, or the ad's own advertiser).
        out["owner_entity_id"] = row["owner_entity_id"]
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
# metering; marketplace has its own reveal on POST /api/marketplace/{id}/reveal, built in R15)
# and different card layouts. Keeping the sections separate is the
# whole point.


def _serialize_marketplace_listing(row: dict) -> dict:
    """Slim projection matching the MarketplaceListing type on the
    frontend. R15 §3d · contact_phone, contact_name, corporation_name
    and corporation_id are ALL omitted — the marketplace reveal
    endpoint (POST /api/marketplace/{id}/reveal) is the only path
    that returns them. is_corporation_verified is kept as an identity-
    free trust signal, same shape as L3's trust_level on worker ads."""
    return {
        "id":              row["id"],
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


# R32 S3 · Hebrew one-letter prefixes that attach to a number
# (`ל-20`, `ב20`). Stripped before the digits test so a quantity the
# rewriter already extracted doesn't stay in the text AND as a word no
# service title will ever contain.
_QTY_PREFIXES = frozenset("לבמהוכש")


def _is_quantity_word(bare: str) -> bool:
    core = bare.strip("-־")
    if len(core) > 1 and core[0] in _QTY_PREFIXES:
        core = core[1:].lstrip("-־")
    return bool(core) and core.isdigit()


def _rewriter_consumed_words(raw_query: str) -> frozenset[str]:
    """R32 S3.2 · the words the rewriter has already turned into filters.

    The rewriter reads `20 פועלים בצפון` as quantity=20,
    profession=general, region=north. Those three words then sit in the
    services text AND as well, where no service title contains them, and
    a query the user expects to surface transport and insurance returns
    nothing at all.

    The keyword maps in `query_rewriter` are read, never written — the
    guardrail for this round. They hold substring stems (`פיגומ`,
    `אוקראינ`), so a token is consumed when it CONTAINS a key, not when
    it equals one: `חשמלאים` contains `חשמלאי`, `בצפון` contains `צפון`.

    Housing words are deliberately absent. `דיור` is what reaches a
    listing through its category display name — dropping it would undo
    what R28 §2 fixed.
    """
    _, tokens = normalize_search_term(raw_query)
    keys = (
        tuple(PROFESSION_KEYWORDS)
        + tuple(ORIGIN_KEYWORDS)
        + tuple(REGION_KEYWORDS)
    )
    consumed: set[str] = set()
    for tok in tokens:
        bare = tok[1:-1] if tok.startswith("%") and tok.endswith("%") else tok
        if not bare:
            continue
        if _is_quantity_word(bare):
            consumed.add(bare)
            continue
        if any(key in bare for key in keys):
            consumed.add(bare)
    return frozenset(consumed)


_MARKETPLACE_SELECT = """
        SELECT ml.*,
               c.company_name_he AS corporation_name_he,
               c.company_name    AS corporation_name_en,
               c.gov_registry_matched_at AS corp_verified_at"""

_MARKETPLACE_FROM = """
          FROM marketplace_listings ml
          LEFT JOIN corporations c ON c.id = ml.corporation_id
          LEFT JOIN marketplace_categories mc ON mc.code = ml.category"""


def _search_marketplace(
    raw_query: str,
    scope_extra: Optional[tuple[list[str], list[object]]] = None,
    filters: Optional[dict] = None,
) -> tuple[list[dict], bool]:
    """Federated marketplace-listings pass — U6 §2 + R28 §2 + R32 S3.

    `scope_extra` (R32 D1): (wheres, params) from
    `services.visibility.marketplace_scope_wheres`. Corporation
    housing is hidden from anonymous, service_provider and
    rejected/suspended contractor callers. Kept as an opaque pair so
    the rule lives in ONE place — do not inline the predicate here.

    R32 S2 · the text predicate lives in
    `search_normalize.marketplace_text_token_clauses`, shared with
    `GET /marketplace?search=`. Four fields, raw + stem per token,
    stopwords dropped. It is the same matcher on both sides, so
    "עוד בשירותים נלווים ←" can no longer lead from a section with
    results to a page without them.

    `filters` (R32 S3) · what the rewriter understood. Two uses:
      * region becomes a soft filter — a listing with no region is
        nationwide and must not disappear, same rule the ads pass
        applies to `available_from`;
      * the words the rewriter consumed are pruned out of the text AND
        (see `_rewriter_consumed_words`).

    Zero-result fallback: when two or more tokens survive and the AND
    matches nothing, the same clauses run once more ORed, ranked by how
    many of them each row matched. `דיור ל-20 פועלים בחיפה` is the case
    this exists for — `בחיפה` is a city the rewriter has no keyword
    for, so it stays in the AND and zeroes a result set that `דיור`
    alone would have filled.

    Returns `(rows, via_fallback)`. R32 R1 (Yulian, 09.11): which pass
    produced the rows decides whether they may suppress unfiltered
    worker inventory. A row the AND found answers the whole query and
    earns that; a row the OR found answered one word of it and does
    not.
    """
    filters = filters or {}
    clauses = marketplace_text_token_clauses(
        raw_query, drop_words=_rewriter_consumed_words(raw_query),
    )
    if not clauses:
        return []

    conditions = ["ml.status = 'active'"]
    params: list[object] = []
    if scope_extra:
        scope_wheres, scope_params = scope_extra
        conditions.extend(scope_wheres)
        params.extend(scope_params)

    # S3.1 · soft region filter. `national` is the rewriter's way of
    # saying "anywhere" (`כל הארץ`), and no listing carries it, so
    # applying it as a predicate would narrow to region-NULL rows —
    # the opposite of what the user asked for.
    region = filters.get("region")
    if region and region != "national":
        conditions.append("(ml.region = %s OR ml.region IS NULL)")
        params.append(region)

    and_conditions = list(conditions)
    and_params = list(params)
    and_conditions.append("(" + " AND ".join(sql for sql, _ in clauses) + ")")
    for _, token_params in clauses:
        and_params.extend(token_params)

    sql = f"""{_MARKETPLACE_SELECT}{_MARKETPLACE_FROM}
         WHERE {' AND '.join(and_conditions)}
         ORDER BY ml.created_at DESC
         LIMIT {MARKETPLACE_LIMIT}
    """
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(sql, and_params)
        rows = cur.fetchall()
        if rows or len(clauses) < 2:
            return [_serialize_marketplace_listing(r) for r in rows], False

        # S3.3 · the AND found nothing and more than one word was in
        # it. Run the same clauses ORed, ranked by how many of them
        # each row matched, so the row that answered most of the query
        # is first. Each clause is bound twice — once in the score,
        # once in the WHERE — so the score params come first.
        score = " + ".join(
            f"CASE WHEN {sql_part} THEN 1 ELSE 0 END" for sql_part, _ in clauses
        )
        or_params: list[object] = []
        for _, token_params in clauses:
            or_params.extend(token_params)
        or_params.extend(params)
        for _, token_params in clauses:
            or_params.extend(token_params)
        or_conditions = list(conditions)
        or_conditions.append("(" + " OR ".join(sql_part for sql_part, _ in clauses) + ")")
        or_sql = f"""{_MARKETPLACE_SELECT},
               ({score}) AS match_score{_MARKETPLACE_FROM}
         WHERE {' AND '.join(or_conditions)}
         ORDER BY match_score DESC, ml.created_at DESC
         LIMIT {MARKETPLACE_LIMIT}
    """
        cur.execute(or_sql, or_params)
        rows = cur.fetchall()
        _log.info(
            "search: marketplace AND returned 0 for %r (%d tokens), "
            "OR fallback returned %d",
            raw_query, len(clauses), len(rows),
        )
        return [_serialize_marketplace_listing(r) for r in rows], True
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
    # via `require_contractor_approved`. R32 D1 · the marketplace pass
    # now carries a scope too, but a narrow one: every caller keeps
    # seeing services, and only corporation housing is withheld.

    filters = rewrite(body.query)

    scope_extra = viewer_scope_wheres(x_entity_id, x_entity_type, x_user_role)

    # R13 §2d · a contractor whose approval hasn't landed gets a scoped
    # 200 rather than the 403 the four sibling public feeds still raise
    # in `require_contractor_approved`, so the FE can render the
    # "החשבון שלך עדיין בבדיקה" copy inside the workers section instead
    # of a red banner. `viewer_approval_status` rides in the response so
    # the FE can pick the right empty-state copy without a second
    # round-trip.
    #
    # R32 D1 · `pending` is now narrower than "see nothing": it hides
    # worker ads and lets housing through, because a contractor waiting
    # on approval is exactly who needs to line up beds. `rejected` and
    # `suspended` keep the R13 behaviour — `1=0`, no ads at all — and so
    # does a contractor whose row has disappeared mid-session
    # (`approval_status is None`, the same opacity rule
    # `require_contractor_approved` applies).
    viewer_approval_status: Optional[str] = None
    if x_entity_type == "contractor" and x_entity_id:
        viewer_approval_status = contractor_approval_status(x_entity_id)
        if viewer_approval_status != "approved":
            wheres, params = scope_extra
            pending_scope = (
                "a.ad_type <> 'worker'"
                if viewer_approval_status == "pending"
                else "1=0"
            )
            scope_extra = (list(wheres) + [pending_scope], list(params))

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

    # R15 §3d · gate owner_entity_id in serialized ads. Approved
    # contractors + admins may see it (contractor's "my ad" detection
    # relies on it); a viewer who happens to be the ad's advertiser
    # sees it on their own rows. anonymous / pending contractor /
    # provider / a corp browsing a foreign row do not.
    _viewer_role_all_ads = (
        x_user_role == "admin"
        or (x_entity_type == "contractor" and viewer_approval_status == "approved")
    )
    def _emit_ad(r):
        owner_visible = _viewer_role_all_ads or (
            bool(x_entity_id) and r.get("owner_entity_id") == x_entity_id
        )
        return _serialize_ad(r, viewer_can_see_owner=owner_visible)

    # Rerank only exact results — near_matches are already sorted by
    # the closest-to-target dimension (quantity DESC or the default
    # boosted+recency); running them through the LLM reranker would
    # cost real money to produce a worse order for a suggestive list.
    #
    # R32 · the rerank call moved BELOW the marketplace pass so it can
    # be skipped when its output is going to be thrown away. See the
    # branch after the suppression rule.
    serialised_exact = [_emit_ad(r) for r in exact_rows]
    serialised_near  = [_emit_ad(r) for r in near_rows]

    # U6 §2 — federated marketplace pass. Runs ALWAYS, on the raw
    # query text (query_rewriter's structured output is meaningless
    # for services). Empty-list is returned when nothing matches —
    # the frontend suppresses the section on empty rather than
    # rendering a hollow heading.
    marketplace_matches, marketplace_via_fallback = _search_marketplace(
        body.query,
        scope_extra=marketplace_scope_wheres(
            x_entity_id, x_entity_type, x_user_role, viewer_approval_status,
        ),
        filters=filters,
    )

    # R30 §31b · inventory is not a result.
    #
    # `_build_where` adds a narrowing predicate ONLY when the rewriter
    # extracted one — profession_code, origin_country or region are each
    # behind an `if`. When it extracted none of them, the worker query
    # carries no filter beyond ad_type + active, so it returns the whole
    # table for any caller whose visibility scope is open (contractor,
    # admin). Anonymous callers get 1=0 and see nothing, which is why a
    # curl and a logged-in browser disagreed so completely on the same
    # query.
    #
    # Clicking "ציוד וכלי עבודה" therefore produced 14 worker ads. Not a
    # rendering bug — the server really returned them. But they are
    # inventory, not an answer, and the query was plainly about
    # something else: marketplace matched three equipment services.
    #
    # Yulian's rule: "מלאי שמוצג כתוצאה הוא שקר קטן שהורס את האמון
    # בחיפוש כולו" — a contractor who gets 14 irrelevant results once
    # will not trust the next search.
    #
    # So: nothing narrowing extracted AND the marketplace DID match →
    # the marketplace hits are the real answer; drop the unfiltered
    # worker rows and let the FE render the phrased empty state.
    #
    # Deliberately NOT suppressed when marketplace is also empty. That
    # is the honest broad-browse path, and the FE already labels it
    # ("לא זיהינו מקצוע מסוים — מציג את כל ההיצע"). Inventory offered AS
    # inventory is fine; inventory dressed as a match is the lie.
    #
    # R32 R1 (Yulian, 09.11) · only the DIRECT pass earns the right to
    # suppress. The OR fallback answers one word of the query, not the
    # query — `השכרת ציוד` reaches three equipment listings through
    # `ציוד` alone, which is not strong enough evidence to delete every
    # worker ad the contractor could still have wanted. So when the
    # hits exist only because of the fallback, the workers stay, in the
    # labelled broad-browse state, and the services go first instead.
    _NARROWING = ("profession_code", "origin_country", "region")
    _unfiltered_browse = (
        bool(serialised_exact) and not any(filters.get(k) for k in _NARROWING)
    )
    fallback_browse = (
        _unfiltered_browse and bool(marketplace_matches) and marketplace_via_fallback
    )
    unfiltered_inventory_suppressed = 0

    # R32 · rerank only when the order it produces will be used.
    #
    # It used to run before any of this, on candidates that were about
    # to be deleted by the rule below — ~1,700 input tokens to order a
    # list nobody would see. And when the rows DO survive as a browse,
    # the reranker was answering `[]` anyway: asked to rank fourteen
    # worker ads against "equipment rental" it correctly says none are
    # relevant, and the SQL order (featured first, then recency) stands.
    #
    # The trade, stated plainly: a broad query whose worker rows the
    # model COULD have ranked usefully now keeps SQL order instead.
    # That is the deliberate price of not paying for a call whose
    # result, every time we have measured it, was discarded.
    if _unfiltered_browse and marketplace_matches:
        if marketplace_via_fallback:
            reranked = serialised_exact
        else:
            unfiltered_inventory_suppressed = len(serialised_exact)
            reranked = []
            # Worth watching: a high rate here means the rewriter is
            # failing to extract on queries that DO have a real intent,
            # and the marketplace is carrying the answer alone.
            _log.info(
                "search: suppressed %d unfiltered worker rows for query %r "
                "(no profession/origin/region extracted, %d marketplace matches)",
                unfiltered_inventory_suppressed, body.query, len(marketplace_matches),
            )
    else:
        reranked = rerank(body.query, serialised_exact)

    # U6 §2 — section ordering. Two rules from the spec:
    #   * profession_code extracted → workers is the intent → 'ads' first.
    #   * nothing extracted BUT marketplace has hits AND ads came up
    #     empty → 'marketplace' first (the marketplace answer is the
    #     only real answer we can give).
    # Ambiguous cases (both non-empty, no profession) still show ads
    # first: the ads pipeline runs through the LLM reranker which
    # already scored the query's intent; marketplace is the surprise
    # bonus, not the headline.
    #
    # R32 R1 · a third rule. When the worker rows survived only because
    # the marketplace hits came from the fallback, both sections are on
    # screen and the services are the better guess at what was asked —
    # so they lead, and the unfiltered worker list sits underneath as
    # the browse it is.
    marketplace_first = (
        not filters.get("profession_code")
        and not reranked
        and bool(marketplace_matches)
    ) or fallback_browse
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
        # R32 S1.5 · which type tabs render locked instead of counted.
        # Viewer-derived, never count-derived, so it cannot be used to
        # probe whether a hidden section had rows in it.
        "hidden_types": hidden_types_for_viewer(
            x_entity_id, x_entity_type, x_user_role, viewer_approval_status,
        ),
    }
