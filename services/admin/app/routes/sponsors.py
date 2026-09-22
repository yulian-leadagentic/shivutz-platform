"""R21 · admin CRUD for sponsor_ads (the ad creative itself).

Before this router the only way a `sponsor_ads` row entered the
database was via a hand-written migration — `sponsor_slots.py` books
a slot to an ad id, but never creates an ad. This closes the last
gap in the ad product: an admin can now create/edit/delete a creative
from the /admin/sponsors screen.

Ownership boundaries:
  * Read path — `services/user-org/app/routes/ads.py` /public/sponsored.
    NOT touched here (R21 guardrail).
  * Slot inventory — `sponsor_slots.py`. Wired from the same admin
    screen but NOT re-implemented.
  * Upload — the frontend uploads directly to Cloudinary via the
    signed-URL endpoint in `services/user-org/app/routes/uploads.py`
    (`/api/uploads/cloudinary-signature`). This router only accepts
    the resulting URL + reported width/height.

Auth: gateway enforces role=admin on /api/admin/*. This module trusts
the gateway and does no re-check.
"""
from datetime import datetime
from typing import Optional
import json
import uuid

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, HttpUrl

from app.db import get_db
from app.services.sponsor_sizes import (
    check_creative_dimensions,
    check_brand_contrast,
    DimensionRejection,
)

router = APIRouter()

# R29 §3-4 · three new slots on top of the R21/R22/U7 originals:
#   * home_leaderboard — 1200×150 wide strip on the home page, above
#                        the fold; composite render is DEFAULT.
#   * home_billboard   — 1200×250 wide strip below the fold; composite
#                        render is DEFAULT.
#   * side_rail        — 300×600 sticky tower shown ONLY on ≥1440
#                        viewports (home + search results + marketplace).
_ALLOWED_PLACEMENTS = {
    "search_inline",
    "marketplace_banner",
    "marketplace_carousel",
    "home_banner",
    "home_carousel",
    "home_leaderboard",
    "home_billboard",
    "side_rail",
}


def _to_iso(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.isoformat()
    return v


def _parse_json_list(raw):
    if raw is None:
        return None
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, list) else None
        except json.JSONDecodeError:
            return None
    return None


def _serialize(row: dict) -> dict:
    return {
        "id":                 row["id"],
        "advertiser_name":    row["advertiser_name"],
        "headline_he":        row["headline_he"],
        "body_he":            row.get("body_he"),
        "chips_he":           _parse_json_list(row.get("chips_he")),
        "cta_label_he":       row["cta_label_he"],
        "cta_url":            row.get("cta_url"),
        "logo_url":           row.get("logo_url"),
        "creative_url":       row.get("creative_url"),
        "creative_w":         row.get("creative_w"),
        "creative_h":         row.get("creative_h"),
        "brand_bg":           row.get("brand_bg"),
        "brand_fg":           row.get("brand_fg"),
        "target_professions": _parse_json_list(row.get("target_professions")),
        "target_ad_types":    _parse_json_list(row.get("target_ad_types")),
        "target_regions":     _parse_json_list(row.get("target_regions")),
        "placements":         _parse_json_list(row.get("placements")),
        "active":             bool(row.get("active")),
        "starts_at":          _to_iso(row.get("starts_at")),
        "ends_at":            _to_iso(row.get("ends_at")),
        "sort_order":         row.get("sort_order") or 0,
        "is_seed":            bool(row.get("is_seed")),
        "created_at":         _to_iso(row.get("created_at")),
        "updated_at":         _to_iso(row.get("updated_at")),
    }


def _validate_placements(placements: Optional[list[str]]) -> None:
    if placements is None:
        return
    for p in placements:
        if p not in _ALLOWED_PLACEMENTS:
            raise HTTPException(
                status_code=400,
                detail={"code": "invalid_placement", "value": p},
            )


def _json_or_none(val):
    """None stays NULL (means 'no targeting on this axis' per 069:46-49).
    Empty list is preserved as [] — the caller explicitly cleared the field.
    """
    if val is None:
        return None
    return json.dumps(val, ensure_ascii=False)


# ── List ──────────────────────────────────────────────────────────────────

@router.get("/sponsors")
def list_sponsors(
    active: Optional[bool] = Query(default=None),
    placement: Optional[str] = Query(default=None),
):
    """Admin sees the whole inventory, past + present + future.

    The current-status label (live / scheduled / ended / off) is derived
    on the client from active + starts_at + ends_at; server payload
    stays minimal.
    """
    wheres: list[str] = []
    params: list[object] = []
    if active is not None:
        wheres.append("active = %s")
        params.append(1 if active else 0)
    if placement:
        if placement not in _ALLOWED_PLACEMENTS:
            raise HTTPException(status_code=400, detail="invalid_placement")
        # Match either explicit membership in placements JSON, or the
        # NULL-≡-search_inline default.
        if placement == "search_inline":
            wheres.append("(placements IS NULL OR JSON_CONTAINS(placements, %s))")
            params.append(json.dumps(placement))
        else:
            wheres.append("JSON_CONTAINS(placements, %s)")
            params.append(json.dumps(placement))

    sql = f"""
        SELECT id, advertiser_name, headline_he, body_he, chips_he,
               cta_label_he, cta_url, logo_url,
               creative_url, creative_w, creative_h,
               brand_bg, brand_fg,
               target_professions, target_ad_types, target_regions,
               placements, active, starts_at, ends_at, sort_order,
               is_seed, created_at, updated_at
          FROM sponsor_ads
         {'WHERE ' + ' AND '.join(wheres) if wheres else ''}
         ORDER BY sort_order ASC, created_at DESC
         LIMIT 500
    """
    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        return [_serialize(r) for r in cur.fetchall()]
    finally:
        conn.close()


# ── Get one ───────────────────────────────────────────────────────────────

@router.get("/sponsors/{ad_id}")
def get_sponsor(ad_id: str):
    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM sponsor_ads WHERE id = %s", (ad_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="sponsor_ad_not_found")
        return _serialize(row)
    finally:
        conn.close()


# ── Create ────────────────────────────────────────────────────────────────

class SponsorCreate(BaseModel):
    advertiser_name: str = Field(min_length=1, max_length=120)
    headline_he:     str = Field(min_length=1, max_length=120)
    body_he:         Optional[str] = Field(default=None, max_length=200)
    chips_he:        Optional[list[str]] = None
    cta_label_he:    str = Field(min_length=1, max_length=40)
    # R20 §3c decision — cta_url is REQUIRED on the admin form. The
    # DB still allows NULL for the legacy 069-078 seed rows that used
    # a decorative label, but any new ad must link somewhere.
    cta_url:         str = Field(min_length=1, max_length=500)
    logo_url:        Optional[str] = Field(default=None, max_length=500)
    creative_url:    Optional[str] = Field(default=None, max_length=500)
    creative_w:      Optional[int] = Field(default=None, ge=1, le=8000)
    creative_h:      Optional[int] = Field(default=None, ge=1, le=8000)
    brand_bg:        Optional[str] = Field(default=None, min_length=7, max_length=7)
    brand_fg:        Optional[str] = Field(default=None, min_length=7, max_length=7)
    target_professions: Optional[list[str]] = None
    target_ad_types:    Optional[list[str]] = None
    target_regions:     Optional[list[str]] = None
    placements:      Optional[list[str]] = None
    active:          bool = False
    starts_at:       Optional[datetime] = None
    ends_at:         Optional[datetime] = None
    sort_order:      int = 0


def _validate_dates(starts_at, ends_at):
    if starts_at and ends_at and ends_at <= starts_at:
        raise HTTPException(
            status_code=400,
            detail="ends_at_must_be_after_starts_at",
        )


def _validate_creative(url, w, h, placements: Optional[list[str]] = None):
    """If any of the three creative fields is set, all three must be.
    Prevents a "url but no aspect ratio" state that would render the
    image without a CLS-safe aspect wrapper on the client.

    R29 §2 addition — when `placements` names one of the known ad
    slots, the (w, h) pair is validated against the approved SIZES
    table (services/admin/app/services/sponsor_sizes.py) with ±3%
    aspect tolerance. Rejection surfaces as HTTP 400 with a Hebrew
    message that names both the required and the received dimensions
    so the admin knows what to re-upload.

    NOTE — this legacy fallback field on `sponsor_ads` (creative_url
    + creative_w/_h) is one image for all placements. R29 §1 adds a
    per-placement per-breakpoint `sponsor_creatives` table that will
    take over for slots that need distinct assets (leaderboard vs
    carousel, desktop vs mobile). The legacy field validates against
    the FIRST known placement in the ad's `placements` list — good
    enough to catch the 1037×609 shape that started this whole
    thread, and NOT enough for real per-slot enforcement. Follow-up
    round wires the sponsor_creatives upload path proper.
    """
    provided = [x for x in (url, w, h) if x is not None]
    if provided and len(provided) != 3:
        raise HTTPException(
            status_code=400,
            detail="creative_url_requires_width_and_height",
        )
    # R29 §2 · dimension enforcement (partial — see docstring).
    if url and w and h and placements:
        for placement in placements:
            try:
                check_creative_dimensions(placement, "desktop", int(w), int(h))
            except DimensionRejection as e:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code":    e.code,
                        "message": e.message_he,
                        **e.extra,
                        "placement": placement,
                    },
                )


def _validate_brand_contrast(brand_fg, brand_bg):
    """R29 §3 tail rule — the composite render paints text in brand_fg
    on brand_bg. WCAG AA requires 4.5:1 for normal body text; the
    headline is bold-ish so this is a conservative floor, not a
    ceiling. Bridges sponsor_sizes.DimensionRejection to HTTP 400 with
    the same shape as the dimension check so admin UI can render both
    error surfaces identically."""
    try:
        check_brand_contrast(brand_fg, brand_bg)
    except DimensionRejection as e:
        raise HTTPException(
            status_code=400,
            detail={"code": e.code, "message": e.message_he, **e.extra},
        )


@router.post("/sponsors", status_code=201)
def create_sponsor(body: SponsorCreate):
    _validate_placements(body.placements)
    _validate_dates(body.starts_at, body.ends_at)
    _validate_creative(body.creative_url, body.creative_w, body.creative_h, body.placements)
    _validate_brand_contrast(body.brand_fg, body.brand_bg)

    new_id = str(uuid.uuid4())
    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO sponsor_ads
                 (id, advertiser_name, headline_he, body_he, chips_he,
                  cta_label_he, cta_url, logo_url,
                  creative_url, creative_w, creative_h,
                  brand_bg, brand_fg,
                  target_professions, target_ad_types, target_regions,
                  placements, active, starts_at, ends_at, sort_order,
                  is_seed)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                       %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 0)""",
            (
                new_id, body.advertiser_name, body.headline_he, body.body_he,
                _json_or_none(body.chips_he),
                body.cta_label_he, body.cta_url, body.logo_url,
                body.creative_url, body.creative_w, body.creative_h,
                body.brand_bg, body.brand_fg,
                _json_or_none(body.target_professions),
                _json_or_none(body.target_ad_types),
                _json_or_none(body.target_regions),
                _json_or_none(body.placements),
                1 if body.active else 0,
                body.starts_at, body.ends_at, body.sort_order,
            ),
        )
        conn.commit()
        cur.execute("SELECT * FROM sponsor_ads WHERE id = %s", (new_id,))
        return _serialize(cur.fetchone())
    finally:
        conn.close()


# ── Update ────────────────────────────────────────────────────────────────

class SponsorPatch(BaseModel):
    advertiser_name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    headline_he:     Optional[str] = Field(default=None, min_length=1, max_length=120)
    body_he:         Optional[str] = Field(default=None, max_length=200)
    chips_he:        Optional[list[str]] = None
    cta_label_he:    Optional[str] = Field(default=None, min_length=1, max_length=40)
    cta_url:         Optional[str] = Field(default=None, max_length=500)
    logo_url:        Optional[str] = Field(default=None, max_length=500)
    creative_url:    Optional[str] = Field(default=None, max_length=500)
    creative_w:      Optional[int] = Field(default=None, ge=1, le=8000)
    creative_h:      Optional[int] = Field(default=None, ge=1, le=8000)
    brand_bg:        Optional[str] = Field(default=None, min_length=7, max_length=7)
    brand_fg:        Optional[str] = Field(default=None, min_length=7, max_length=7)
    target_professions: Optional[list[str]] = None
    target_ad_types:    Optional[list[str]] = None
    target_regions:     Optional[list[str]] = None
    placements:      Optional[list[str]] = None
    active:          Optional[bool] = None
    starts_at:       Optional[datetime] = None
    ends_at:         Optional[datetime] = None
    sort_order:      Optional[int] = None
    # Explicit null-out toggles. PATCH cannot distinguish "field
    # omitted" from "field set to null" in Pydantic v1 style. These
    # let the admin form clear a creative or its aspect wrapper.
    clear_creative:  Optional[bool] = False
    clear_dates:     Optional[bool] = False


@router.patch("/sponsors/{ad_id}")
def update_sponsor(ad_id: str, body: SponsorPatch):
    _validate_placements(body.placements)

    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM sponsor_ads WHERE id = %s", (ad_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="sponsor_ad_not_found")

        # Compute the effective (post-patch) dates for the validator.
        new_starts = row["starts_at"] if body.starts_at is None else body.starts_at
        new_ends   = row["ends_at"]   if body.ends_at   is None else body.ends_at
        if body.clear_dates:
            new_starts = None
            new_ends   = None
        _validate_dates(new_starts, new_ends)

        # Same for creative — the trio must move together.
        if body.clear_creative:
            new_url, new_w, new_h = None, None, None
        else:
            new_url = row["creative_url"] if body.creative_url is None else body.creative_url
            new_w   = row["creative_w"]   if body.creative_w   is None else body.creative_w
            new_h   = row["creative_h"]   if body.creative_h   is None else body.creative_h
        # R29 §2 · aspect check on the update path, WITH grandfathering.
        # The rule from R29 §2: "האכיפה חלה על העלאות חדשות בלבד" —
        # existing rows keep rendering; only new uploads get bounced.
        # Fire the dimension check only when the request actually
        # touched the dimensions (either creative_w or creative_h is
        # present in the incoming body) OR when creative_url itself
        # is being set/replaced. Metadata-only edits (CTA label, dates,
        # active flag) leave the creative alone and never invoke the
        # new SIZES gate. `body.placements` still takes precedence
        # when picking which slot to validate against; falls back to
        # the row's current stored placements otherwise.
        # R29 §3 · brand contrast check on update. Same
        # grandfathering rule as the creative dimensions above: only
        # fire when the caller actually touched brand_fg or brand_bg;
        # a metadata-only save on a legacy row with a low-contrast
        # colour pair stays editable.
        new_fg = row.get("brand_fg") if body.brand_fg is None else body.brand_fg
        new_bg = row.get("brand_bg") if body.brand_bg is None else body.brand_bg
        if body.brand_fg is not None or body.brand_bg is not None:
            _validate_brand_contrast(new_fg, new_bg)
        creative_touched = (
            body.creative_url is not None
            or body.creative_w   is not None
            or body.creative_h   is not None
            or body.clear_creative
        )
        effective_placements = body.placements if body.placements is not None else _parse_json_list(row.get("placements"))
        if creative_touched:
            _validate_creative(new_url, new_w, new_h, effective_placements)
        else:
            # Trio invariant still enforced for safety, without SIZES.
            _validate_creative(new_url, new_w, new_h, None)

        sets: list[str] = []
        params: list[object] = []

        def _set(col, val):
            sets.append(f"{col}=%s")
            params.append(val)

        if body.advertiser_name is not None: _set("advertiser_name", body.advertiser_name)
        if body.headline_he     is not None: _set("headline_he",     body.headline_he)
        if body.body_he         is not None: _set("body_he",         body.body_he or None)
        if body.chips_he        is not None: _set("chips_he",        _json_or_none(body.chips_he))
        if body.cta_label_he    is not None: _set("cta_label_he",    body.cta_label_he)
        if body.cta_url         is not None: _set("cta_url",         body.cta_url or None)
        if body.logo_url        is not None: _set("logo_url",        body.logo_url or None)
        if body.brand_bg        is not None: _set("brand_bg",        body.brand_bg or None)
        if body.brand_fg        is not None: _set("brand_fg",        body.brand_fg or None)
        if body.target_professions is not None:
            _set("target_professions", _json_or_none(body.target_professions))
        if body.target_ad_types    is not None:
            _set("target_ad_types",    _json_or_none(body.target_ad_types))
        if body.target_regions     is not None:
            _set("target_regions",     _json_or_none(body.target_regions))
        if body.placements      is not None: _set("placements",      _json_or_none(body.placements))
        if body.active          is not None: _set("active",          1 if body.active else 0)
        if body.sort_order      is not None: _set("sort_order",      body.sort_order)

        # Creative + dates arrive through the effective values above.
        if body.clear_creative or any(x is not None for x in (body.creative_url, body.creative_w, body.creative_h)):
            _set("creative_url", new_url)
            _set("creative_w",   new_w)
            _set("creative_h",   new_h)
        if body.clear_dates or body.starts_at is not None:
            _set("starts_at", new_starts)
        if body.clear_dates or body.ends_at   is not None:
            _set("ends_at",   new_ends)

        if not sets:
            return _serialize(row)

        params.append(ad_id)
        cur.execute(f"UPDATE sponsor_ads SET {', '.join(sets)} WHERE id=%s", params)
        conn.commit()
        cur.execute("SELECT * FROM sponsor_ads WHERE id=%s", (ad_id,))
        return _serialize(cur.fetchone())
    finally:
        conn.close()


# ── Delete ────────────────────────────────────────────────────────────────

@router.delete("/sponsors/{ad_id}", status_code=204)
def delete_sponsor(ad_id: str):
    """Hard-delete. Any sponsor_ads_slots row that points at this ad
    gets its `sponsor_ad_id` cleared to NULL (unbooked slot survives).
    """
    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        # Unbook any booked slots first; keep the slot inventory intact.
        cur.execute(
            "UPDATE sponsor_ads_slots SET sponsor_ad_id = NULL WHERE sponsor_ad_id = %s",
            (ad_id,),
        )
        cur.execute("DELETE FROM sponsor_ads WHERE id = %s", (ad_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="sponsor_ad_not_found")
        conn.commit()
    finally:
        conn.close()
