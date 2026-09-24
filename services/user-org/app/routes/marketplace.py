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
from app.services.search_normalize import normalize_search_term
from app.services.phone_normalize import normalize_or_400
from app.services.seed_visibility import seed_where

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
        else:
            result[k] = _coerce(v)
    return result


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
):
    """Public listing. Pass mine=true to get only your own listings (auth required)."""
    conn = get_db()
    try:
        cur = conn.cursor()
        conditions = ["ml.deleted_at IS NULL"]
        params: list = []

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
            conditions.append("ml.region = %s")
            params.append(region)
        if city:
            conditions.append("ml.city LIKE %s")
            params.append(f"%{city}%")
        if min_capacity is not None:
            conditions.append("ml.capacity >= %s")
            params.append(min_capacity)
        if search:
            # U6 §2b-1 — normalize before hitting LIKE. Raw user input
            # was matched literally, so `ביטוח,` (with trailing comma,
            # very common Hebrew habit) returned zero rows even though
            # `ביטוח` did. The shared normalizer strips edge
            # punctuation, splits multi-word queries into AND-of-LIKE
            # tokens, and escapes `%`/`_` wildcards. When the input
            # reduces to nothing (e.g. lone comma), we silently drop
            # the search filter rather than returning zero rows.
            _, tokens = normalize_search_term(search)
            if tokens:
                per_token = []
                for tok in tokens:
                    per_token.append(
                        "(ml.title LIKE %s ESCAPE '\\\\' "
                        "OR ml.description LIKE %s ESCAPE '\\\\' "
                        "OR ml.city LIKE %s ESCAPE '\\\\')"
                    )
                    params.extend([tok, tok, tok])
                conditions.append("(" + " AND ".join(per_token) + ")")

        # R30 · seed listings are never served in production. One gate,
        # shared with the sponsor-ads path; a no-op on staging where the
        # demo inventory lives.
        _seed = seed_where("ml")
        if _seed:
            conditions.append(_seed)

        where = " AND ".join(conditions)
        params.extend([limit, offset])

        cur.execute(f"""
            SELECT ml.*,
                   c.company_name_he AS corporation_name_he,
                   c.company_name    AS corporation_name_en,
                   c.approval_status AS corporation_approval_status
              FROM marketplace_listings ml
              LEFT JOIN corporations c ON ml.corporation_id = c.id
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
    return result


@router.get("/categories")
def list_public_categories():
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT code, name_he, name_en, icon_slug, sort_order
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
):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT ml.*,
                   c.company_name_he AS corporation_name_he,
                   c.company_name    AS corporation_name_en,
                   c.approval_status AS corporation_approval_status
              FROM marketplace_listings ml
              LEFT JOIN corporations c ON ml.corporation_id = c.id
             WHERE ml.id = %s AND ml.deleted_at IS NULL
        """ + (f" AND {seed_where('ml')}" if seed_where('ml') else "") + """
        """, (listing_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Listing not found")
        include_owner = _caller_owns(row, x_entity_id or x_org_id, x_entity_type)
        r = _serialize(row, include_owner_fields=include_owner)
        r["is_corporation_verified"] = row.get("corporation_approval_status") == "approved"
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
        cur.execute("""
            SELECT ml.contact_phone, ml.contact_name,
                   ml.advertiser_entity_id, ml.advertiser_entity_type,
                   ml.corporation_id,
                   c.company_name_he AS corporation_name_he,
                   c.company_name    AS corporation_name_en
              FROM marketplace_listings ml
              LEFT JOIN corporations c ON ml.corporation_id = c.id
             WHERE ml.id = %s AND ml.deleted_at IS NULL AND ml.status = 'active'
        """, (listing_id,))
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
    # U7 §2b · service_provider publishes free across all provider
    # categories (equipment, services, other + any admin-added). Housing
    # is reserved for corp; worker is reserved for corp workers. This
    # branch is the exact mirror of is_corp_housing above — same
    # subscription/slot bypass, same NULL subscription_id on the row.
    _PROVIDER_BLOCKED_CATEGORIES = {"housing", "worker"}
    is_provider_free = (
        entity_type == "service_provider"
        and body.category not in _PROVIDER_BLOCKED_CATEGORIES
    )
    if entity_type == "service_provider" and not is_provider_free:
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
    conn = get_db()
    try:
        cur = conn.cursor()

        # subscription_id + slot accounting only apply to callers that
        # go through the marketplace_subscriptions path (contractors,
        # and future U7 service_providers). Corp housing is licensed
        # elsewhere and skips this branch entirely.
        sub_id:     Optional[str] = None
        slot_count: Optional[int] = None
        used = 0

        if not is_corp_housing and not is_provider_free:
            # Find an active subscription that covers this category + has a
            # free slot. Locking the row would matter only at very high
            # concurrency; for now a serialized read is fine.
            cur.execute(
                """SELECT id, slot_count
                     FROM marketplace_subscriptions
                    WHERE advertiser_entity_type = %s
                      AND advertiser_entity_id   = %s
                      AND category_code          = %s
                      AND status                 = 'active'
                      AND expires_at             > NOW()
                    ORDER BY expires_at DESC LIMIT 1""",
                (entity_type, entity_id, body.category),
            )
            sub = cur.fetchone()
            if not sub:
                raise HTTPException(
                    status_code=402,  # 402 Payment Required — closest fit
                    detail={
                        "code": "no_active_subscription",
                        "message": "אין מנוי פעיל בקטגוריה זו. רכוש מנוי כדי לפרסם.",
                        "category": body.category,
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
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "no_slots_available",
                        "message": "כל מקומות הפרסום במנוי הזה מנוצלים. השבת מודעה קיימת או שדרג את המנוי.",
                        "slot_count": sub["slot_count"],
                        "slots_used": used,
                    },
                )
            sub_id     = sub["id"]
            slot_count = sub["slot_count"]

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
               available_from, contact_phone, contact_name, images_json)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, (
            listing_id, legacy_corp_id, sub_id,
            entity_type, entity_id,
            body.category, body.subcategory, body.title.strip(), body.description,
            body.city, body.region, body.price, body.price_unit,
            body.capacity, body.is_furnished, body.available_from,
            # R30 §15 · contact_phone is what a contractor calls to reach
            # the advertiser — it was stored verbatim. Optional field, so
            # blank stays blank, but a supplied value must be a real
            # Israeli mobile and is stored canonically.
            normalize_or_400(body.contact_phone, required=False), body.contact_name,
            json.dumps(images) if images else None,
        ))
        conn.commit()
        return {
            "id":              listing_id,
            "status":          "active",
            # `subscription_id` is null for corp housing; slots not
            # tracked. Contractor + provider responses carry the
            # existing pair, unchanged.
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
            """SELECT id, corporation_id, advertiser_entity_id
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
        for field, val in body.model_dump(exclude_none=True).items():
            if field == "images_json":
                # images_json is a JSON column; cap and serialize.
                imgs = val if isinstance(val, list) else []
                if len(imgs) > _MAX_IMAGES_PER_LISTING:
                    imgs = imgs[:_MAX_IMAGES_PER_LISTING]
                updates.append("images_json=%s")
                params.append(json.dumps(imgs) if imgs else None)
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
        if x_user_role != "admin" and not is_owner:
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
