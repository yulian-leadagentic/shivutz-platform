"""
Marketplace — public listings board.
Corporations post housing/equipment/services. Anyone can browse.
"""
from fastapi import APIRouter, HTTPException, Header, Query
from pydantic import BaseModel
from typing import Optional, List
from decimal import Decimal
import json
import uuid

from app.db import get_db
from app.services.admin_check import is_admin
from app.services.listing_attributes import (
    REGION_MATCH_SQL, attribute_view, card_price, load_schema, parse_schema,
    single_region, validate_attributes, validate_regions,
)
from app.services.provider_plans import PROVIDER_BLOCKED_CATEGORIES
from app.services.search_normalize import marketplace_text_conditions
from app.services.phone_normalize import normalize_or_400
from app.services.seed_visibility import seed_where
from app.services.visibility import (
    contractor_approval_status,
    marketplace_scope_wheres,
)

router = APIRouter()

# ── Pydantic models ────────────────────────────────────────────────────────────

class ListingCreate(BaseModel):
    category:       str                    # housing | equipment | services | other
    subcategory:    Optional[str] = None
    title:          str
    description:    Optional[str] = None
    city:           Optional[str] = None
    region:         Optional[str] = None
    price:          Optional[Decimal] = None
    price_unit:     Optional[str] = None   # per_month | per_night | fixed | negotiable
    capacity:       Optional[int] = None
    is_furnished:   Optional[bool] = None
    available_from: Optional[str] = None   # ISO date
    contact_phone:  Optional[str] = None
    contact_name:   Optional[str] = None
    # Cloudinary secure_urls — accepted from the frontend after the
    # browser → Cloudinary direct upload completes. Capped server-side
    # so a malicious client can't pad the JSON column with thousands.
    images_json:    Optional[List[str]] = None
    # R34 4c · the answers to the category's own questions
    # (marketplace_categories.field_schema), and the regions served.
    attributes:     Optional[dict] = None
    regions:        Optional[List[str]] = None

class ListingUpdate(BaseModel):
    title:          Optional[str] = None
    description:    Optional[str] = None
    city:           Optional[str] = None
    region:         Optional[str] = None
    price:          Optional[Decimal] = None
    price_unit:     Optional[str] = None
    capacity:       Optional[int] = None
    is_furnished:   Optional[bool] = None
    available_from: Optional[str] = None
    contact_phone:  Optional[str] = None
    contact_name:   Optional[str] = None
    status:         Optional[str] = None   # active | rented | sold | paused
    images_json:    Optional[List[str]] = None
    attributes:     Optional[dict] = None
    regions:        Optional[List[str]] = None

# Soft-cap on stored image URLs per listing — protects against runaway
# JSON columns. Not enforced at the DB level; FE shouldn't allow more
# either (Cloudinary uploader caps too).
_MAX_IMAGES_PER_LISTING = 12

class LeadCreate(BaseModel):
    full_name: str
    phone:     str
    org_type:  str   # contractor | corporation
    notes:     Optional[str] = None


# R15 §3a · Explicit ALLOW-LIST of the fields a marketplace listing
# projects into a public response. Contact_phone, contact_name,
# corporation_name and corporation_id are DELIBERATELY absent — they
# ride the /reveal endpoint. is_corporation_verified is a boolean
# trust signal with no identity in it (same shape as L3's trust_level
# on worker ads), so it stays public.
#
# Never revert this to a pass-through. The pre-R15 code was
# `for k, v in row.items(): result[k] = v` and it dripped every
# marketplace advertiser's phone number to any anon curl for months.
# A new column added tomorrow will drip the same way if the projection
# is column-count based instead of an explicit list.
_PUBLIC_LISTING_FIELDS = (
    "id",
    "category",
    "subcategory",
    "title",
    "description",
    "city",
    "region",
    "price",
    "price_unit",
    "capacity",
    "is_furnished",
    "available_from",
    "images_json",
    # R34 4c · what the listing answered and where it serves. Neither
    # identifies the advertiser.
    "attributes",
    "regions",
    "status",
    "created_at",
    "updated_at",
    "advertiser_entity_type",
    # is_corporation_verified is computed by the caller from the
    # LEFT-JOINed approval_status column (see list_listings and
    # get_listing below) and appended to the projection after
    # _serialize returns. It is NOT a raw column on the row.
)

# Extra fields exposed to the OWNER of a listing (see §3b) and to
# admin. The reveal endpoint returns the same set for a paying viewer.
_OWNER_LISTING_FIELDS = _PUBLIC_LISTING_FIELDS + (
    "contact_phone",
    "contact_name",
)


def _coerce(v):
    """Type-normalize a single value: dates → ISO string, Decimal → float."""
    if hasattr(v, "isoformat"):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    return v


def _serialize(row: dict, *, include_owner_fields: bool = False) -> dict:
    """Public-safe projection. ONLY the fields in
    _PUBLIC_LISTING_FIELDS survive; everything else on the row is
    dropped, including contact_phone / contact_name / corporation_id /
    is_seed / subscription_id / advertiser_entity_id / deleted_at.

    Callers that legitimately need the owner-only fields (the listing's
    own advertiser hitting mine=true; admin; the reveal endpoint) pass
    include_owner_fields=True to widen to _OWNER_LISTING_FIELDS.
    """
    fields = _OWNER_LISTING_FIELDS if include_owner_fields else _PUBLIC_LISTING_FIELDS
    result: dict = {}
    for k in fields:
        if k not in row:
            continue
        v = row[k]
        if k == "images_json":
            if isinstance(v, str):
                try:
                    result[k] = json.loads(v)
                except json.JSONDecodeError:
                    result[k] = []
            else:
                result[k] = v or []
        elif k in ("attributes", "regions"):
            # JSON columns arrive as text.
            if isinstance(v, (str, bytes, bytearray)):
                try:
                    v = json.loads(v)
                except (json.JSONDecodeError, UnicodeDecodeError):
                    v = None
            result[k] = v
        else:
            result[k] = _coerce(v)
    return result


def _listing_scope(
    x_entity_id:   Optional[str],
    x_entity_type: Optional[str],
    x_user_role:   Optional[str],
) -> tuple[list, list]:
    """R32 D1 · the corporation-housing scope for this caller.

    Hits `contractors.approval_status` only when the caller actually is
    a contractor — every other branch of `marketplace_scope_wheres` is
    decided by the headers alone, so an anonymous browse stays a single
    query.
    """
    entity_type = (x_entity_type or "").lower() or None
    approval = None
    if entity_type == "contractor" and x_entity_id:
        approval = contractor_approval_status(x_entity_id)
    return marketplace_scope_wheres(
        x_entity_id, entity_type, x_user_role, approval,
    )


def _caller_owns(row: dict, x_entity_id: Optional[str], x_entity_type: Optional[str]) -> bool:
    """Whether the caller is the row's advertiser. Same test list_listings
    uses under `mine=true`: match on advertiser_entity_(id|type) with the
    corporation_id fallback for legacy corp rows written before U7."""
    if not x_entity_id:
        return False
    et = (x_entity_type or "").lower()
    # advertiser_entity_* is the new dimension covering all three types.
    if row.get("advertiser_entity_id") == x_entity_id and (
        not row.get("advertiser_entity_type") or row["advertiser_entity_type"] == et
    ):
        return True
    # Legacy fallback — a pre-U7 corp row may only have corporation_id.
    if et == "corporation" and row.get("corporation_id") == x_entity_id:
        return True
    return False


# ── GET /marketplace ───────────────────────────────────────────────────────────

@router.get("")
def list_listings(
    category:     Optional[str] = Query(default=None),
    region:       Optional[str] = Query(default=None),
    city:         Optional[str] = Query(default=None),
    min_capacity: Optional[int] = Query(default=None),
    search:       Optional[str] = Query(default=None),
    mine:         bool          = Query(default=False),
    limit:        int           = Query(default=50, le=100),
    offset:       int           = Query(default=0),
    x_entity_id:  Optional[str] = Header(default=None),
    x_org_id:     Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
    x_user_role:  Optional[str] = Header(default=None),
):
    """Public listing. Pass mine=true to get only your own listings (auth required)."""
    conn = get_db()
    try:
        cur = conn.cursor()
        conditions = ["ml.deleted_at IS NULL"]
        params: list = []

        # R32 D1 · corporation housing is withheld from anonymous,
        # service_provider and rejected/suspended contractor callers.
        # Applied before `mine` so it cannot be sidestepped: a caller's
        # own rows are never corporation housing unless the caller IS
        # the corporation, and that branch is unscoped.
        scope_wheres, scope_params = _listing_scope(
            x_entity_id or x_org_id, x_entity_type, x_user_role,
        )
        conditions.extend(scope_wheres)
        params.extend(scope_params)

        if mine:
            entity_id = x_entity_id or x_org_id
            entity_type = (x_entity_type or "").lower()
            if not entity_id:
                raise HTTPException(status_code=401, detail="Auth required for mine=true")
            # Match against advertiser_entity_* (the new dimension).
            # corporation_id is kept in sync for legacy corp rows so we
            # could query either, but advertiser_entity_* covers both
            # contractor and corp advertisers cleanly.
            conditions.append("ml.advertiser_entity_id = %s")
            params.append(entity_id)
            # U7 §1: provider is a third advertiser type on the same table.
            if entity_type in ("contractor", "corporation", "service_provider"):
                conditions.append("ml.advertiser_entity_type = %s")
                params.append(entity_type)
        else:
            conditions.append("ml.status = 'active'")

        if category:
            conditions.append("ml.category = %s")
            params.append(category)
        if region:
            # R34 4c · a listing can serve several regions, or all of
            # them. Until now this was `ml.region = %s`, which also
            # dropped every listing with no region at all.
            conditions.append(REGION_MATCH_SQL)
            params.extend([region, region])
        if city:
            conditions.append("ml.city LIKE %s")
            params.append(f"%{city}%")
        if min_capacity is not None:
            conditions.append("ml.capacity >= %s")
            params.append(min_capacity)
        if search:
            # R32 S2 · the same matcher the federated pass in search.py
            # uses. This endpoint used to match three fields with no
            # stem and no stopwords, so the identical query returned
            # fewer rows here than in the search section that linked to
            # it. When the input reduces to nothing (a lone comma) the
            # predicate comes back empty and the filter is dropped
            # rather than returning zero rows.
            text_sql, text_params = marketplace_text_conditions(search)
            if text_sql:
                conditions.append(text_sql)
                params.extend(text_params)

        # R30 · seed listings are never served in production. One gate,
        # shared with the sponsor-ads path; a no-op on staging where the
        # demo inventory lives.
        _seed = seed_where("ml")
        if _seed:
            conditions.append(_seed)

        where = " AND ".join(conditions)
        params.extend([limit, offset])

        # R32 S2 · the `mc` join is what `marketplace_text_conditions`
        # needs for its fourth field (the category's display name).
        # Without it `?search=דיור` could not find a listing titled
        # `מתחם מגורים`, which is precisely the gap that made the
        # search section and this endpoint disagree.
        cur.execute(f"""
            SELECT ml.*,
                   c.company_name_he AS corporation_name_he,
                   c.company_name    AS corporation_name_en,
                   c.approval_status AS corporation_approval_status
              FROM marketplace_listings ml
              LEFT JOIN corporations c ON ml.corporation_id = c.id
              LEFT JOIN marketplace_categories mc ON mc.code = ml.category
             WHERE {where}
             ORDER BY ml.created_at DESC
             LIMIT %s OFFSET %s
        """, params)

        rows = cur.fetchall()
        result = []
        for row in rows:
            # R15 §3b · a caller who is the row's advertiser gets the
            # owner projection (contact fields included) so their own
            # dashboard can still show what they wrote. mine=true is
            # the natural entry point; a signed-in owner hitting the
            # public list without mine=true would also see their own
            # rows unmasked, which is fine — they wrote them.
            include_owner = _caller_owns(row, x_entity_id or x_org_id, x_entity_type)
            r = _serialize(row, include_owner_fields=include_owner)
            # is_corporation_verified is a public trust signal (same
            # shape as L3's trust_level on worker ads) — approved corp
            # = ✓, anything else = ✗. Corporation name + id ride the
            # reveal endpoint; only the boolean survives here.
            r["is_corporation_verified"] = row.get("corporation_approval_status") == "approved"
            result.append(r)
        return result
    finally:
        conn.close()


# ── GET /marketplace/categories ────────────────────────────────────────────────
# U1 §3b — the public marketplace page ships a hardcoded 4-item category
# list. Admin-side, categories are configurable via
# /marketplace/admin/categories, so the public page can drift the moment
# an admin renames "שירותים" or adds a fifth code. Expose the active
# categories publicly so both surfaces stay in lockstep. The listing
# route below matches /{listing_id} greedily, so this MUST be defined
# first for FastAPI's ordered matching.

# R27 §1 · dedicated allow-list projection for marketplace_categories
# rows. Previously this route reused `_serialize`, which is scoped to
# marketplace_listings columns (contact_phone leak guard from R15 §3a).
# The overlap between the two schemas is empty, so `_serialize` dropped
# every category field and the endpoint returned [{}, {}, {}, ...] —
# blocking provider registration because /register/provider's category
# picker rendered rows with no code/label. Keep the two allow-lists
# separate so R15's phone-leak guard stays intact.
_PUBLIC_CATEGORY_FIELDS = ("code", "name_he", "name_en", "icon_slug", "sort_order")

def _serialize_category(row: dict) -> dict:
    result: dict = {}
    for k in _PUBLIC_CATEGORY_FIELDS:
        if k not in row:
            continue
        result[k] = _coerce(row[k])
    # R34 4c · what the category asks of a listing, parsed. Public: it
    # is a list of questions, and the listing form reads it.
    if "field_schema" in row:
        result["field_schema"] = parse_schema(row["field_schema"])
    return result


@router.get("/categories")
def list_public_categories():
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT code, name_he, name_en, icon_slug, sort_order, field_schema
                 FROM marketplace_categories
                WHERE is_active = 1
                ORDER BY sort_order, code"""
        )
        return [_serialize_category(r) for r in cur.fetchall()]
    finally:
        conn.close()


# ── GET /marketplace/:id ───────────────────────────────────────────────────────

@router.get("/{listing_id}")
def get_listing(
    listing_id: str,
    x_entity_id:   Optional[str] = Header(default=None),
    x_org_id:      Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
    x_user_role:   Optional[str] = Header(default=None),
):
    # R32 D1 · a caller who may not see corporation housing gets the
    # same 404 a deleted listing gets. 403 would confirm the row
    # exists, which is the one bit of information the rule is meant to
    # withhold — same opacity the reveal endpoint already uses.
    scope_wheres, scope_params = _listing_scope(
        x_entity_id or x_org_id, x_entity_type, x_user_role,
    )
    conditions = ["ml.id = %s", "ml.deleted_at IS NULL"] + scope_wheres
    if seed_where("ml"):
        conditions.append(seed_where("ml"))
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(f"""
            SELECT ml.*,
                   c.company_name_he AS corporation_name_he,
                   c.company_name    AS corporation_name_en,
                   c.approval_status AS corporation_approval_status
              FROM marketplace_listings ml
              LEFT JOIN corporations c ON ml.corporation_id = c.id
             WHERE {' AND '.join(conditions)}
        """, (listing_id, *scope_params))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Listing not found")
        include_owner = _caller_owns(row, x_entity_id or x_org_id, x_entity_type)
        r = _serialize(row, include_owner_fields=include_owner)
        r["is_corporation_verified"] = row.get("corporation_approval_status") == "approved"
        # R34 4c · the answers in the schema's order, each with the
        # schema's label, so the panel shows them without a second
        # request and without its own copy of the labels.
        r["attribute_fields"] = (
            attribute_view(load_schema(cur, row["category"]), row.get("attributes"))
            if row.get("attributes") else []
        )
        return r
    finally:
        conn.close()


# ── POST /marketplace/:id/reveal (R15 §3c) ────────────────────────────────────
# Returns contact_phone, contact_name, corporation_name for a listing
# to any signed-in caller EXCEPT a pending/rejected/suspended contractor.
#
# NOT metered — services provided to workers (housing, transport,
# insurance, equipment) are not the priced-reveal channel; worker-ad
# reveals are (contact_reveals with tier quotas). Gate-ing this behind
# a subscription would kill the primary channel R13 opened up: a corp
# looking for a bunk-house / an insurance policy for its workers is
# exactly the audience whose search was opened.
#
# 🔴 SEMANTICS PENDING YULIAN APPROVAL — the eligibility rule above
# ("every signed-in entity except pending contractor") is my proposal.
# Marked here + in the R15 report + in bugs_manual_round_0919.md. Do
# not tighten to a subscription gate without an explicit "אושר" line
# in a follow-up prompt.

@router.post("/{listing_id}/reveal")
def reveal_listing_contact(
    listing_id:    str,
    x_entity_id:   Optional[str] = Header(default=None),
    x_org_id:      Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
    x_user_role:   Optional[str] = Header(default=None),
):
    # Anonymous is 401. There's no meaningful signal we could give an
    # unauthenticated caller that wouldn't be a functional bypass of
    # the same rule the /reveal endpoint on worker ads enforces.
    caller_id = x_entity_id or x_org_id
    caller_type = (x_entity_type or "").lower()
    if not caller_id or not caller_type:
        raise HTTPException(status_code=401, detail={"code": "auth_required"})

    # A pending / rejected / suspended contractor is 403. Everyone else
    # (approved contractor, corp, service_provider, admin) → 200.
    conn = get_db()
    try:
        cur = conn.cursor()
        if caller_type == "contractor":
            cur.execute(
                "SELECT approval_status FROM contractors WHERE id=%s AND deleted_at IS NULL",
                (caller_id,),
            )
            crow = cur.fetchone()
            if not crow or (
                crow["approval_status"] if isinstance(crow, dict) else crow[0]
            ) != "approved":
                raise HTTPException(status_code=403, detail={"code": "entity_not_approved"})

        # Fetch the listing + corp name in one shot. 404 if the listing
        # is deleted / bogus id — same opacity as the reveal endpoint
        # on worker ads.
        #
        # R32 D1 · the scope rides in the same WHERE, so a caller who
        # may not see corporation housing 404s HERE — before the
        # marketplace_reveals audit insert below. That is deliberate:
        # a reveal that was refused is not a reveal, and recording it
        # would put rows in the audit table for contacts the caller
        # never received.
        scope_wheres, scope_params = _listing_scope(
            caller_id, caller_type, x_user_role,
        )
        conditions = [
            "ml.id = %s",
            "ml.deleted_at IS NULL",
            "ml.status = 'active'",
        ] + scope_wheres
        cur.execute(f"""
            SELECT ml.contact_phone, ml.contact_name,
                   ml.advertiser_entity_id, ml.advertiser_entity_type,
                   ml.corporation_id,
                   c.company_name_he AS corporation_name_he,
                   c.company_name    AS corporation_name_en
              FROM marketplace_listings ml
              LEFT JOIN corporations c ON ml.corporation_id = c.id
             WHERE {' AND '.join(conditions)}
        """, (listing_id, *scope_params))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail={"code": "listing_not_found"})

        # Audit — one row per (viewer, listing) pair, so a re-click
        # collapses to the same row. See migration 086.
        cur.execute("""
            INSERT INTO marketplace_reveals (viewer_entity_id, viewer_entity_type, listing_id)
                VALUES (%s, %s, %s)
            ON DUPLICATE KEY UPDATE viewer_entity_id = viewer_entity_id""",
            (caller_id, caller_type, listing_id),
        )
        conn.commit()

        return {
            "listing_id":       listing_id,
            "contact_phone":    row.get("contact_phone"),
            "contact_name":     row.get("contact_name"),
            "corporation_name": row.get("corporation_name_he") or row.get("corporation_name_en"),
        }
    finally:
        conn.close()


# ── A plan with room for one more listing ─────────────────────────────────────

def _plan_with_free_slot(cur, entity_type: str, entity_id: str, category: str):
    """The advertiser's running plan in `category`, if it can take one
    more listing: (plan id, slot_count, slots already used).

    402 no_active_subscription when there is no running plan there,
    402 no_slots_available when it is full. Shared by the two ways a
    listing becomes published: creating it, and turning a paused one
    back on.

    Locking the row would matter only at very high concurrency; for now
    a serialized read is fine.
    """
    cur.execute(
        """SELECT id, slot_count
             FROM marketplace_subscriptions
            WHERE advertiser_entity_type = %s
              AND advertiser_entity_id   = %s
              AND category_code          = %s
              AND status                 = 'active'
              AND expires_at             > NOW()
            ORDER BY expires_at DESC LIMIT 1""",
        (entity_type, entity_id, category),
    )
    sub = cur.fetchone()
    is_provider = entity_type == "service_provider"
    if not sub:
        raise HTTPException(
            status_code=402,  # 402 Payment Required, the closest fit
            detail={
                "code": "no_active_subscription",
                "message": (
                    "אין לך מסלול פעיל בקטגוריה זו. כדי לפרסם בה יש להוסיף מסלול."
                    if is_provider
                    else "אין מנוי פעיל בקטגוריה זו. רכוש מנוי כדי לפרסם."
                ),
                "category": category,
                # Where this caller gets a plan. Only providers have
                # such a page; the form turns it into a link.
                "buy_url": f"/provider/marketplace/subscribe?category={category}" if is_provider else None,
            },
        )

    cur.execute(
        """SELECT COUNT(*) AS n FROM marketplace_listings
            WHERE subscription_id = %s
              AND deleted_at IS NULL
              AND status = 'active'""",
        (sub["id"],),
    )
    used = int(cur.fetchone()["n"])
    if used >= sub["slot_count"]:
        # R33 B · 402, not 409: the way out is a bigger plan, the same
        # answer as having no plan at all. The listings already
        # published are untouched; only this one is refused.
        raise HTTPException(
            status_code=402,
            detail={
                "code": "no_slots_available",
                "message": "כל מקומות הפרסום במנוי הזה מנוצלים. השבת מודעה קיימת או שדרג את המנוי.",
                "category": category,
                "slot_count": sub["slot_count"],
                "slots_used": used,
                # R34 5a · the plan exists, so the page that helps is
                # the one where it can be upgraded.
                "buy_url": f"/provider/billing?category={category}" if is_provider else None,
            },
        )
    return sub["id"], sub["slot_count"], used


# ── POST /marketplace ──────────────────────────────────────────────────────────

@router.post("", status_code=201)
def create_listing(
    body: ListingCreate,
    x_entity_id:  Optional[str] = Header(default=None),
    x_org_id:     Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    """Publish a new listing.

    Phase 2.1 changes:
    - Both contractors and corporations can publish (V0 was corp-only).
    - Requires an active subscription in the chosen category with at
      least one available slot. The subscription is found from the
      caller + body.category and recorded on the listing for billing
      and for slot accounting.
    """
    entity_id   = x_entity_id or x_org_id
    entity_type = (x_entity_type or "").lower()
    # U7 §2b — `service_provider` is the third valid advertiser type,
    # added by migration 077. Denying it here would 403 a registered
    # provider trying to publish their first listing — the exact
    # rejection the U7 spec called out. Contractor + corporation
    # paths below are unchanged.
    if not entity_id or entity_type not in ("contractor", "corporation", "service_provider"):
        raise HTTPException(status_code=403, detail="advertiser_required")
    if not body.title.strip():
        raise HTTPException(status_code=400, detail="title_required")
    if not body.category:
        raise HTTPException(status_code=400, detail="category_required")

    # U8 §2 · corporation housing-only permission gate.
    #
    # Yulian, 14.09: "תאגיד יכול לפרסם רק דיור בנוסף לעובדים, וזה
    # נכלל בחלק מהרישיון שיש לו, אין צורך להוסיף תשלום."
    #
    # This is a permission gate, NOT a billing gate:
    #   * corporation + housing  → allowed. `marketplace_subscriptions`
    #                              is skipped entirely; the license
    #                              already includes housing, so we
    #                              don't hit the 402 path and don't
    #                              charge a slot. `subscription_id`
    #                              stays NULL on the row.
    #   * corporation + anything else → 403 corp_housing_only. Other
    #                              categories (equipment, services,
    #                              other) are reserved for service
    #                              providers (U7).
    #   * contractor + any category → unchanged. Subscription still
    #                              required.
    #
    # PATCH doesn't need a mirror of this check — the ListingUpdate
    # model deliberately omits `category`, so a corp cannot flip a
    # housing listing to equipment after the fact. `grep 'category'
    # services/user-org/app/routes/marketplace.py` confirms POST is
    # the only mutator that takes a category.
    is_corp_housing = entity_type == "corporation" and body.category == "housing"
    # R33 B.1 · a provider publishes only in a category where it has an
    # active plan (Yulian, 15.11). From U7 until this round a provider
    # skipped the subscription check altogether and its listings were
    # written with subscription_id NULL, so the plan row created at
    # registration was never read by anything. A provider now takes the
    # same subscription-and-slot path a contractor does, below. The
    # launch promo does not change that: the plan may have cost 0, the
    # listing is still linked to it.
    #
    # The category guard stays: housing is the corporation's, and
    # worker ads are not marketplace listings.
    if entity_type == "service_provider" and body.category in PROVIDER_BLOCKED_CATEGORIES:
        raise HTTPException(
            status_code=403,
            detail={
                "code":    "provider_category_forbidden",
                "message": (
                    "ספק שירות יכול לפרסם בקטגוריות שירות בלבד — "
                    "לא ניתן לפרסם דיור או עובדים דרך חשבון ספק."
                ),
                "category": body.category,
            },
        )
    if entity_type == "corporation" and not is_corp_housing:
        raise HTTPException(
            status_code=403,
            detail={
                "code":    "corp_housing_only",
                "message": (
                    "תאגיד יכול לפרסם דיור בלבד. "
                    "קטגוריות נוספות זמינות לספקי שירותים."
                ),
                "category": body.category,
            },
        )

    listing_id = str(uuid.uuid4())
    regions = validate_regions(body.regions)
    conn = get_db()
    try:
        cur = conn.cursor()

        # R34 4c · the category's own questions. Checked before a slot
        # is looked for, so a form that is simply filled in wrong is
        # told so and not "no room in your plan".
        schema = load_schema(cur, body.category)
        attributes = validate_attributes(schema, body.attributes)
        # The card and the search results read `price` and `price_unit`.
        # Where the category's answers include the price, that is what
        # goes there; a caller that sent the two columns itself (the
        # corporation's housing form) keeps what it sent.
        price, price_unit = body.price, body.price_unit
        if price is None and attributes:
            price, price_unit = card_price(schema, attributes)
        elif price is None and not attributes and schema and (schema.get("price") or {}).get("note"):
            price_unit = schema["price"]["note"]

        # subscription_id + slot accounting apply to every caller that
        # goes through the marketplace_subscriptions path: contractors
        # and, since R33 B.1, service providers. Corp housing is
        # licensed elsewhere and skips this branch entirely.
        sub_id:     Optional[str] = None
        slot_count: Optional[int] = None
        used = 0

        if not is_corp_housing:
            sub_id, slot_count, used = _plan_with_free_slot(
                cur, entity_type, entity_id, body.category,
            )

        # `corporation_id` is preserved for the V0 read path until 2.2
        # rewrites browse to use advertiser_entity_*; for contractor
        # advertisers we leave it NULL.
        legacy_corp_id = entity_id if entity_type == "corporation" else None
        images = body.images_json or []
        if len(images) > _MAX_IMAGES_PER_LISTING:
            images = images[:_MAX_IMAGES_PER_LISTING]
        cur.execute("""
            INSERT INTO marketplace_listings
              (id, corporation_id, subscription_id,
               advertiser_entity_type, advertiser_entity_id,
               category, subcategory, title, description,
               city, region, price, price_unit, capacity, is_furnished,
               available_from, contact_phone, contact_name, images_json,
               attributes, regions)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, (
            listing_id, legacy_corp_id, sub_id,
            entity_type, entity_id,
            body.category, body.subcategory, body.title.strip(), body.description,
            # `regions` is the full answer; `region` keeps the single
            # value for a listing that has exactly one.
            body.city, single_region(regions) if regions else body.region, price, price_unit,
            body.capacity, body.is_furnished, body.available_from,
            # R30 §15 · contact_phone is what a contractor calls to reach
            # the advertiser — it was stored verbatim. Optional field, so
            # blank stays blank, but a supplied value must be a real
            # Israeli mobile and is stored canonically.
            normalize_or_400(body.contact_phone, required=False), body.contact_name,
            json.dumps(images) if images else None,
            json.dumps(attributes, ensure_ascii=False) if attributes else None,
            json.dumps(regions) if regions else None,
        ))
        conn.commit()
        return {
            "id":              listing_id,
            "status":          "active",
            # `subscription_id` is null for corp housing only; slots
            # are not tracked there. Contractors and providers get the
            # plan the listing was filed under and its slot count.
            "subscription_id": sub_id,
            "slots_used":      used + 1 if sub_id else None,
            "slot_count":      slot_count,
        }
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


# ── PATCH /marketplace/:id ─────────────────────────────────────────────────────

@router.patch("/{listing_id}")
def update_listing(
    listing_id: str,
    body: ListingUpdate,
    x_entity_id: Optional[str] = Header(default=None),
    x_org_id:    Optional[str] = Header(default=None),
):
    entity_id = x_entity_id or x_org_id
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT id, corporation_id, advertiser_entity_id, advertiser_entity_type,
                      category, status
                 FROM marketplace_listings WHERE id=%s AND deleted_at IS NULL""",
            (listing_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Listing not found")
        # Owner check — match either the legacy corporation_id (existing
        # corp-side rows) or the new advertiser_entity_id (contractor or
        # newly-created rows).
        is_owner = (row["corporation_id"] == entity_id) or (row["advertiser_entity_id"] == entity_id)
        if not is_owner:
            raise HTTPException(status_code=403, detail="Forbidden")

        updates, params = [], []
        # R34 5a · a listing going back to 'active' takes a slot, the
        # way a new one does, and is filed under the plan that has it.
        # Until now this was a plain column write: pausing listings
        # freed their slots, new ones could be created in them, and
        # the paused ones could then be switched back on, past the
        # plan's size. It also let a listing return after its plan was
        # cancelled. Corporation listings are not on a plan (housing
        # rides the licence) and are left as they were.
        if (
            body.status == "active"
            and row["status"] != "active"
            and row["advertiser_entity_type"] in ("contractor", "service_provider")
        ):
            plan_id, _, _ = _plan_with_free_slot(
                cur, row["advertiser_entity_type"], row["advertiser_entity_id"], row["category"],
            )
            updates.append("subscription_id=%s")
            params.append(plan_id)
        for field, val in body.model_dump(exclude_none=True).items():
            if field == "images_json":
                # images_json is a JSON column; cap and serialize.
                imgs = val if isinstance(val, list) else []
                if len(imgs) > _MAX_IMAGES_PER_LISTING:
                    imgs = imgs[:_MAX_IMAGES_PER_LISTING]
                updates.append("images_json=%s")
                params.append(json.dumps(imgs) if imgs else None)
            elif field == "attributes":
                # R34 4c · the whole set is replaced and checked whole,
                # so a required answer cannot be dropped by an edit.
                schema = load_schema(cur, row["category"])
                clean = validate_attributes(schema, val)
                updates.append("attributes=%s")
                params.append(json.dumps(clean, ensure_ascii=False) if clean else None)
                if "price" not in body.model_fields_set:
                    price, price_unit = card_price(schema, clean)
                    updates.extend(["price=%s", "price_unit=%s"])
                    params.extend([price, price_unit])
            elif field == "regions":
                regions = validate_regions(val)
                updates.extend(["regions=%s", "region=%s"])
                params.extend([json.dumps(regions) if regions else None, single_region(regions)])
            elif field == "contact_phone":
                # R30 §15 · same rule as create. exclude_none means we
                # only reach here when the caller actually sent the
                # field, so a present-but-malformed value is a 400
                # rather than a silently stored string.
                updates.append("contact_phone=%s")
                params.append(normalize_or_400(val, required=False))
            else:
                updates.append(f"{field}=%s")
                params.append(val)
        if not updates:
            return {"id": listing_id, "updated": False}

        params.append(listing_id)
        cur.execute(f"UPDATE marketplace_listings SET {', '.join(updates)} WHERE id=%s", params)
        conn.commit()
        return {"id": listing_id, "updated": True}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


# ── DELETE /marketplace/:id ────────────────────────────────────────────────────

@router.delete("/{listing_id}", status_code=204)
def delete_listing(
    listing_id: str,
    x_entity_id: Optional[str] = Header(default=None),
    x_org_id:    Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
    x_user_is_admin: Optional[str] = Header(default=None),
):
    entity_id = x_entity_id or x_org_id
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT id, corporation_id, advertiser_entity_id
                 FROM marketplace_listings WHERE id=%s AND deleted_at IS NULL""",
            (listing_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Listing not found")
        is_owner = (row["corporation_id"] == entity_id) or (row["advertiser_entity_id"] == entity_id)
        if not is_admin(x_user_is_admin, x_user_role) and not is_owner:
            raise HTTPException(status_code=403, detail="Forbidden")

        cur.execute("UPDATE marketplace_listings SET deleted_at=NOW(), status='paused' WHERE id=%s", (listing_id,))
        conn.commit()
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


# ── POST /marketplace/leads ────────────────────────────────────────────────────

@router.post("/leads", status_code=201)
def submit_lead(body: LeadCreate):
    if not body.full_name.strip():
        raise HTTPException(status_code=400, detail="שם וטלפון הם שדות חובה")
    # R30 §15 · a lead IS a phone number — an unreachable one is a
    # worthless row. Was .strip() only.
    phone = normalize_or_400(body.phone)
    if body.org_type not in ("contractor", "corporation"):
        raise HTTPException(status_code=400, detail="org_type must be contractor or corporation")

    lead_id = str(uuid.uuid4())
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO leads (id, full_name, phone, org_type, notes) VALUES (%s,%s,%s,%s,%s)",
            (lead_id, body.full_name.strip(), phone, body.org_type, body.notes)
        )
        conn.commit()
        return {"id": lead_id, "message": "תודה! ניצור איתך קשר בקרוב"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()
# Wave 4 deploy probe — 2026-05-07T09:12:51Z
