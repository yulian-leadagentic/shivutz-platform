"""Pivot/v2 Phase 2 — corporation worker/housing ads.

Corp-owner CRUD on the `ads` table. Read-only public discovery comes
in Phase 3 (free-text search). For now, only the entity that owns the
ad can see/edit it.

Phase 2 ships WORKER ads only on the UI side; the schema already has
housing columns so Phase 4 doesn't need a migration.

Boost: marks an ad as featured_until = now + 7 days. Real promotion
billing lands in Phase 5 — for now `boost` is free and just flips
the column.
"""
import json
import os
import uuid
from datetime import datetime, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.db import get_db
from app.publisher import publish_event
from app.services.subscription_limits import fetch_entitlement, tier_limits

router = APIRouter()

PAYMENT_SVC = os.getenv("PAYMENT_SERVICE_URL", "http://payment:3009")

AD_DEFAULT_DAYS = 30
BOOST_DAYS         = 7
BOOST_PER_DAY_NIS  = 5   # D1 anchor — mirrors the frontend CP3 CTA
BOOST_TOTAL_NIS    = BOOST_DAYS * BOOST_PER_DAY_NIS


def _serialize(row: dict) -> dict:
    out = dict(row)
    for k, v in list(out.items()):
        if isinstance(v, datetime):
            out[k] = v.isoformat()
        if k in ("languages", "amenities", "photos") and isinstance(v, str):
            try:
                out[k] = json.loads(v)
            except Exception:
                pass
    return out


def _require_corp(x_entity_id: Optional[str], x_entity_type: Optional[str]) -> str:
    if not x_entity_id:
        raise HTTPException(status_code=401, detail="no_entity_context")
    if x_entity_type != "corporation":
        raise HTTPException(status_code=403, detail="corp_only")
    return x_entity_id


# ─── Pydantic ───────────────────────────────────────────────────────────────

class AdIn(BaseModel):
    ad_type: str  # 'worker' | 'housing'
    title_he: str = Field(..., min_length=2, max_length=255)
    body_he:  Optional[str] = None

    # Worker fields
    profession_code:       Optional[str]      = None
    origin_country:        Optional[str]      = None
    region:                Optional[str]      = None
    quantity:              Optional[int]      = None
    experience_min_months: Optional[int]      = None
    visa_valid_until:      Optional[str]      = None  # YYYY-MM-DD
    languages:             Optional[list[str]] = None

    # Housing fields (Phase 4 — accepted but UI doesn't post them yet)
    city:              Optional[str]       = None
    address_he:        Optional[str]       = None
    total_beds:        Optional[int]       = None
    available_beds:    Optional[int]       = None
    price_per_bed_nis: Optional[int]       = None
    amenities:         Optional[list[str]] = None
    photos:            Optional[list[str]] = None

    # Lifecycle
    expires_at: Optional[str] = None  # ISO; defaults to now + AD_DEFAULT_DAYS


class AdPatch(BaseModel):
    title_he:              Optional[str]       = None
    body_he:               Optional[str]       = None
    profession_code:       Optional[str]       = None
    origin_country:        Optional[str]       = None
    region:                Optional[str]       = None
    quantity:              Optional[int]       = None
    experience_min_months: Optional[int]       = None
    visa_valid_until:      Optional[str]       = None
    languages:             Optional[list[str]] = None
    city:                  Optional[str]       = None
    address_he:            Optional[str]       = None
    total_beds:            Optional[int]       = None
    available_beds:        Optional[int]       = None
    price_per_bed_nis:     Optional[int]       = None
    amenities:             Optional[list[str]] = None
    photos:                Optional[list[str]] = None
    active:                Optional[bool]      = None
    expires_at:            Optional[str]       = None


# ─── POST /ads ──────────────────────────────────────────────────────────────

@router.post("", status_code=201)
def create_ad(
    body: AdIn,
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    corp_id = _require_corp(x_entity_id, x_entity_type)
    if body.ad_type not in ("worker", "housing"):
        raise HTTPException(status_code=400, detail="invalid_ad_type")

    # Tier-cap active-ad count. Phase 5 gate — see subscription_limits.
    try:
        ent = fetch_entitlement(corp_id, "corporation")
    except httpx.HTTPError:
        # Payment down — fail closed but with a clearer error than 500.
        raise HTTPException(status_code=503, detail="entitlement_service_unreachable")
    if not ent["entitled"]:
        raise HTTPException(status_code=402, detail={"code": "subscription_required", "tier": ent["tier"], "status": ent["status"]})
    limits = tier_limits(ent["tier"], "corporation")
    if limits["active_ads"] is not None:
        _conn = get_db()
        try:
            _cur = _conn.cursor()
            _cur.execute(
                "SELECT COUNT(*) AS n FROM ads WHERE owner_entity_id=%s AND deleted_at IS NULL AND active=TRUE",
                (corp_id,),
            )
            row = _cur.fetchone()
            n = int(row["n"] if row else 0)
        finally:
            _conn.close()
        if n >= limits["active_ads"]:
            raise HTTPException(status_code=402, detail={
                "code":  "tier_active_ad_limit",
                "tier":  ent["tier"],
                "limit": limits["active_ads"],
                "used":  n,
            })

    ad_id = str(uuid.uuid4())

    # Ad lifetime cap from the tier plan.
    # - Cap on user-supplied expires_at at max_ad_lifetime_days.
    # - Default expires_at = now + max_ad_lifetime_days (or NULL if the
    #   tier allows unlimited lifetime).
    max_life = limits.get("max_ad_lifetime_days")
    ceiling  = (datetime.utcnow() + timedelta(days=max_life)) if max_life else None
    if body.expires_at:
        try:
            requested = datetime.fromisoformat(body.expires_at.replace("Z", "+00:00"))
            if ceiling and requested > ceiling:
                expires_at = ceiling.isoformat()
            else:
                expires_at = body.expires_at
        except ValueError:
            expires_at = ceiling.isoformat() if ceiling else None
    else:
        expires_at = ceiling.isoformat() if ceiling else None

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO ads
                 (id, owner_entity_id, owner_entity_type, ad_type,
                  title_he, body_he,
                  profession_code, origin_country, region, quantity,
                  experience_min_months, visa_valid_until, languages,
                  city, address_he, total_beds, available_beds,
                  price_per_bed_nis, amenities, photos,
                  expires_at)
               VALUES (%s, %s, 'corporation', %s,
                       %s, %s,
                       %s, %s, %s, %s,
                       %s, %s, %s,
                       %s, %s, %s, %s,
                       %s, %s, %s,
                       %s)""",
            (
                ad_id, corp_id, body.ad_type,
                body.title_he, body.body_he,
                body.profession_code, body.origin_country, body.region, body.quantity,
                body.experience_min_months, body.visa_valid_until,
                json.dumps(body.languages, ensure_ascii=False) if body.languages else None,
                body.city, body.address_he, body.total_beds, body.available_beds,
                body.price_per_bed_nis,
                json.dumps(body.amenities, ensure_ascii=False) if body.amenities else None,
                json.dumps(body.photos, ensure_ascii=False) if body.photos else None,
                expires_at,
            ),
        )
        conn.commit()
        cur.execute("SELECT * FROM ads WHERE id=%s", (ad_id,))
        return _serialize(cur.fetchone())
    finally:
        conn.close()


# ─── GET /ads/usage — current caller's tier + counters (Phase 5) ────────────

@router.get("/usage")
def usage(
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    if not x_entity_id or not x_entity_type:
        raise HTTPException(status_code=401, detail="auth_required")
    try:
        ent = fetch_entitlement(x_entity_id, x_entity_type)
    except httpx.HTTPError:
        raise HTTPException(status_code=503, detail="entitlement_service_unreachable")
    limits = tier_limits(ent["tier"], "corporation")

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT COUNT(*) AS n FROM contact_reveals
                WHERE viewer_entity_id=%s AND viewer_entity_type=%s
                  AND revealed_at >= DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00')""",
            (x_entity_id, x_entity_type),
        )
        reveals_used = int(cur.fetchone()["n"])

        # B3 — grace fields for the corp trial-end banner. Frontend
        # decides grace state client-side by comparing NOW to these.
        cur.execute(
            """SELECT trial_ends_at, grace_ends_at
                 FROM payment_db.subscriptions
                WHERE entity_id=%s AND entity_type=%s
                LIMIT 1""",
            (x_entity_id, x_entity_type),
        )
        sub_row = cur.fetchone()
        trial_ends_at = (sub_row["trial_ends_at"].isoformat()
                         if sub_row and sub_row["trial_ends_at"] else None)
        grace_ends_at = (sub_row["grace_ends_at"].isoformat()
                         if sub_row and sub_row["grace_ends_at"] else None)

        active_ads_used         = 0
        ads_by_type: dict[str, int] = {"worker": 0, "housing": 0}
        reveals_received_30d    = 0
        if x_entity_type == "corporation":
            cur.execute(
                "SELECT COUNT(*) AS n FROM ads WHERE owner_entity_id=%s AND deleted_at IS NULL AND active=TRUE",
                (x_entity_id,),
            )
            active_ads_used = int(cur.fetchone()["n"])

            cur.execute(
                """SELECT ad_type, COUNT(*) AS n FROM ads
                    WHERE owner_entity_id=%s AND deleted_at IS NULL AND active=TRUE
                    GROUP BY ad_type""",
                (x_entity_id,),
            )
            for r in cur.fetchall():
                ads_by_type[r["ad_type"]] = int(r["n"])

            cur.execute(
                """SELECT COUNT(*) AS n FROM contact_reveals cr
                     JOIN ads a ON a.id = cr.ad_id
                    WHERE a.owner_entity_id=%s
                      AND cr.revealed_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)""",
                (x_entity_id,),
            )
            reveals_received_30d = int(cur.fetchone()["n"])
    finally:
        conn.close()

    return {
        "tier":     ent["tier"],
        "status":   ent["status"],
        "entitled": ent["entitled"],
        "limits":   limits,
        "trial_ends_at": trial_ends_at,
        "grace_ends_at": grace_ends_at,
        "usage": {
            "reveals_this_month":    reveals_used,
            "active_ads":            active_ads_used,
            "ads_by_type":           ads_by_type,
            "reveals_received_30d":  reveals_received_30d,
        },
    }


# ─── Public landing endpoints (yad2-style landing) ──────────────────────────
# No auth required. Return sanitized ad payloads (owner id omitted) so
# the anonymous landing page can render featured + recent ads and real
# stats without exposing contact info (that's still behind the reveal
# subscription gate).

_PUBLIC_AD_COLS = (
    "id, ad_type, title_he, body_he, region, "
    "profession_code, origin_country, quantity, "
    "city, available_beds, price_per_bed_nis, amenities, photos, "
    "featured_until, published_at"
)


def _public_ad(row: dict) -> dict:
    out = _serialize(row)
    # Never expose owner id from the public feed — the reveal endpoint
    # is the only path that surfaces corp contact info.
    for k in ("owner_entity_id", "owner_entity_type"):
        out.pop(k, None)
    return out


@router.get("/public/featured")
def public_featured(limit: int = 12):
    """Boosted ads first, then most-recent active. Powers the landing
    carousel + trust bar."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            f"""SELECT {_PUBLIC_AD_COLS}
                  FROM ads
                 WHERE active=TRUE AND deleted_at IS NULL
                   AND (expires_at IS NULL OR expires_at > NOW())
                   AND featured_until IS NOT NULL AND featured_until > NOW()
                 ORDER BY featured_until DESC, published_at DESC
                 LIMIT %s""",
            (max(1, min(limit, 50)),),
        )
        return {"results": [_public_ad(r) for r in cur.fetchall()]}
    finally:
        conn.close()


@router.get("/public/recent")
def public_recent(limit: int = 12, ad_type: Optional[str] = None):
    conn = get_db()
    try:
        cur = conn.cursor()
        params: list[object] = []
        wheres = ["active=TRUE", "deleted_at IS NULL",
                  "(expires_at IS NULL OR expires_at > NOW())"]
        if ad_type in ("worker", "housing"):
            wheres.append("ad_type=%s")
            params.append(ad_type)
        params.append(max(1, min(limit, 50)))
        cur.execute(
            f"""SELECT {_PUBLIC_AD_COLS}
                  FROM ads
                 WHERE {' AND '.join(wheres)}
                 ORDER BY published_at DESC
                 LIMIT %s""",
            params,
        )
        return {"results": [_public_ad(r) for r in cur.fetchall()]}
    finally:
        conn.close()


@router.get("/public/stats")
def public_stats():
    """Aggregate numbers for the landing trust bar. Numeric only —
    nothing that identifies a specific entity."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) AS n FROM corporations WHERE approval_status='approved' AND deleted_at IS NULL")
        active_corps = int(cur.fetchone()["n"])
        cur.execute("SELECT ad_type, COUNT(*) AS n FROM ads WHERE active=TRUE AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > NOW()) GROUP BY ad_type")
        by_type = {r["ad_type"]: int(r["n"]) for r in cur.fetchall()}
        cur.execute("SELECT COUNT(*) AS n FROM contact_reveals WHERE revealed_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)")
        reveals_30d = int(cur.fetchone()["n"])
    finally:
        conn.close()
    return {
        "active_corps":       active_corps,
        "worker_ads":         by_type.get("worker", 0),
        "housing_ads":        by_type.get("housing", 0),
        "reveals_last_30d":   reveals_30d,
    }


# ─── GET /ads/mine ──────────────────────────────────────────────────────────

@router.get("/mine")
def list_my_ads(
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    """Corp's own ads with a per-ad reveal_count subquery.

    Pivot/v2 (CP2): reveals is the value metric — corps see how many
    contractors actually revealed their contact info, not raw views.
    """
    corp_id = _require_corp(x_entity_id, x_entity_type)
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT a.*,
                      (SELECT COUNT(*) FROM contact_reveals cr
                        WHERE cr.ad_id = a.id) AS reveal_count
                 FROM ads a
                WHERE a.owner_entity_id=%s AND a.deleted_at IS NULL
                ORDER BY a.featured_until DESC, a.created_at DESC""",
            (corp_id,),
        )
        return [_serialize(r) for r in cur.fetchall()]
    finally:
        conn.close()


def _fetch_owned(cur, ad_id: str, corp_id: str) -> dict:
    cur.execute(
        "SELECT * FROM ads WHERE id=%s AND owner_entity_id=%s AND deleted_at IS NULL",
        (ad_id, corp_id),
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="ad_not_found")
    return row


# ─── GET /ads/{id} ──────────────────────────────────────────────────────────

@router.get("/{ad_id}")
def get_ad(
    ad_id: str,
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    corp_id = _require_corp(x_entity_id, x_entity_type)
    conn = get_db()
    try:
        cur = conn.cursor()
        return _serialize(_fetch_owned(cur, ad_id, corp_id))
    finally:
        conn.close()


# ─── PATCH /ads/{id} ────────────────────────────────────────────────────────

# Whitelist of editable columns. JSON columns are encoded inline.
_SCALAR_COLS = {
    "title_he", "body_he",
    "profession_code", "origin_country", "region", "quantity",
    "experience_min_months", "visa_valid_until",
    "city", "address_he", "total_beds", "available_beds", "price_per_bed_nis",
    "active", "expires_at",
}
_JSON_COLS = {"languages", "amenities", "photos"}


@router.patch("/{ad_id}")
def update_ad(
    ad_id: str,
    body:  AdPatch,
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    corp_id = _require_corp(x_entity_id, x_entity_type)
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="no_changes")

    # Soft trial cap: editing existing ads requires an active/trialing
    # subscription. Existing ads keep serving search results even when
    # the sub lapses (see decision Q4a in the pivot flow plan).
    try:
        ent = fetch_entitlement(corp_id, "corporation")
    except httpx.HTTPError:
        raise HTTPException(status_code=503, detail="entitlement_service_unreachable")
    if not ent["entitled"]:
        raise HTTPException(status_code=402, detail={
            "code": "subscription_required", "tier": ent["tier"], "status": ent["status"],
        })

    sets:   list[str]    = []
    params: list[object] = []
    for k, v in data.items():
        if k in _SCALAR_COLS:
            sets.append(f"{k}=%s")
            params.append(v)
        elif k in _JSON_COLS:
            sets.append(f"{k}=%s")
            params.append(json.dumps(v, ensure_ascii=False) if v is not None else None)
    if not sets:
        raise HTTPException(status_code=400, detail="no_editable_fields")

    params.extend([ad_id, corp_id])
    sql = f"UPDATE ads SET {', '.join(sets)} WHERE id=%s AND owner_entity_id=%s AND deleted_at IS NULL"

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="ad_not_found")
        conn.commit()
        cur.execute("SELECT * FROM ads WHERE id=%s", (ad_id,))
        return _serialize(cur.fetchone())
    finally:
        conn.close()


# ─── DELETE /ads/{id} (soft) ────────────────────────────────────────────────

@router.delete("/{ad_id}", status_code=204)
def delete_ad(
    ad_id: str,
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    corp_id = _require_corp(x_entity_id, x_entity_type)
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE ads SET deleted_at=NOW(), active=FALSE WHERE id=%s AND owner_entity_id=%s AND deleted_at IS NULL",
            (ad_id, corp_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="ad_not_found")
        conn.commit()
    finally:
        conn.close()


# ─── GET /ads/{id}/contact-reveal (subscription-gated) ────────────────────
#
# Phase 3 paywall. Anyone (even non-logged) can search and see ad
# bodies; only paying subscribers see the corp's phone/email. We
# call the payment service's /subscriptions/check endpoint to gate
# this — same pattern Phase 5's gateway middleware will use, but
# inline here so contact-reveal works before middleware ships.

# ─── Internal cron endpoints (called by notification service) ──────────────
#
# Both use a "get-and-latch" pattern in one tx: the SELECT returns
# rows to notify AND the UPDATE marks them notified. The cron doesn't
# have to make a second call, and a network failure between the two
# is impossible (never re-notifies + never mis-flags).

@router.post("/internal/trial-ending-batch")
def trial_ending_batch(days_ahead: int = 3):
    """Trialing subs whose trial ends within days_ahead and haven't
    been notified. Marks them notified in the same tx. Corp/contractor
    contact phone is joined in so the cron can SMS directly."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT s.id AS sub_id, s.entity_id, s.entity_type, s.tier,
                      s.trial_ends_at,
                      TIMESTAMPDIFF(DAY, NOW(), s.trial_ends_at) AS days_left,
                      COALESCE(c.contact_phone, ct.contact_phone) AS phone,
                      COALESCE(c.company_name_he, c.company_name,
                               ct.company_name_he, ct.company_name)     AS entity_name
                 FROM payment_db.subscriptions s
                 LEFT JOIN corporations c  ON s.entity_type='corporation' AND c.id  = s.entity_id
                 LEFT JOIN contractors  ct ON s.entity_type='contractor'  AND ct.id = s.entity_id
                WHERE s.status='trialing'
                  AND s.trial_ends_at > NOW()
                  AND s.trial_ends_at <= DATE_ADD(NOW(), INTERVAL %s DAY)
                  AND s.trial_expiry_notified_at IS NULL""",
            (days_ahead,),
        )
        rows = cur.fetchall()
        if rows:
            ids = [r["sub_id"] for r in rows]
            ph  = ",".join(["%s"] * len(ids))
            cur.execute(
                f"UPDATE payment_db.subscriptions SET trial_expiry_notified_at=NOW() WHERE id IN ({ph})",
                ids,
            )
            conn.commit()
        return {
            "targets": [
                {
                    "sub_id":      r["sub_id"],
                    "entity_type": r["entity_type"],
                    "entity_name": r["entity_name"],
                    "tier":        r["tier"],
                    "phone":       r["phone"],
                    "days_left":   int(r["days_left"] or 0),
                }
                for r in rows if r["phone"]  # skip anything we can't SMS
            ]
        }
    finally:
        conn.close()


@router.post("/internal/ad-expiring-batch")
def ad_expiring_batch(days_ahead: int = 3):
    """Active ads whose expires_at is within days_ahead and haven't
    been notified. Same latch pattern."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT a.id AS ad_id, a.title_he, a.owner_entity_id,
                      a.expires_at, a.ad_type,
                      TIMESTAMPDIFF(DAY, NOW(), a.expires_at) AS days_left,
                      c.contact_phone AS phone
                 FROM ads a
                 JOIN corporations c ON c.id = a.owner_entity_id
                WHERE a.active = TRUE
                  AND a.deleted_at IS NULL
                  AND a.expires_at IS NOT NULL
                  AND a.expires_at > NOW()
                  AND a.expires_at <= DATE_ADD(NOW(), INTERVAL %s DAY)
                  AND a.expiry_notified_at IS NULL""",
            (days_ahead,),
        )
        rows = cur.fetchall()
        if rows:
            ids = [r["ad_id"] for r in rows]
            ph  = ",".join(["%s"] * len(ids))
            cur.execute(
                f"UPDATE ads SET expiry_notified_at=NOW() WHERE id IN ({ph})",
                ids,
            )
            conn.commit()
        return {
            "targets": [
                {
                    "ad_id":     r["ad_id"],
                    "title":     r["title_he"],
                    "ad_type":   r["ad_type"],
                    "phone":     r["phone"],
                    "days_left": int(r["days_left"] or 0),
                }
                for r in rows if r["phone"]
            ]
        }
    finally:
        conn.close()


@router.post("/internal/grace-batch")
def grace_batch():
    """Corp trial-end grace SMS batch (spec B3).

    Sequence of 4 sends after `trial_ends_at`:
      step 1 = day 0 (trial just ended, 7 days until pause)
      step 2 = day 3
      step 3 = day 6 (tomorrow the ads pause)
      step 4 = day 7 (ads paused — renew to restore)

    Returns every sub whose "due step" (derived from days since
    trial_ends_at) is greater than its `grace_sms_step` counter — so
    if the cron missed a day, it catches up on the next run instead
    of silently skipping. Latches each returned row to its new step
    in the same tx so a retry can't double-send.
    """
    GRACE_OFFSETS = [(1, 0), (2, 3), (3, 6), (4, 7)]  # (step, day-offset)
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT s.id AS sub_id, s.entity_id, s.entity_type, s.tier,
                      s.trial_ends_at, s.grace_ends_at, s.grace_sms_step,
                      TIMESTAMPDIFF(DAY, s.trial_ends_at, NOW()) AS days_since_trial,
                      COALESCE(c.contact_phone, ct.contact_phone) AS phone,
                      COALESCE(c.company_name_he, c.company_name,
                               ct.company_name_he, ct.company_name)     AS entity_name
                 FROM payment_db.subscriptions s
                 LEFT JOIN corporations c  ON s.entity_type='corporation' AND c.id  = s.entity_id
                 LEFT JOIN contractors  ct ON s.entity_type='contractor'  AND ct.id = s.entity_id
                WHERE s.status='trialing'
                  AND s.trial_ends_at IS NOT NULL
                  AND s.trial_ends_at <= NOW()
                  AND s.grace_sms_step < 4"""
        )
        targets = []
        for r in cur.fetchall():
            days = int(r["days_since_trial"] or 0)
            due_step = 0
            for step, offset in GRACE_OFFSETS:
                if days >= offset:
                    due_step = step
            if due_step <= int(r["grace_sms_step"] or 0):
                continue
            if not r["phone"]:
                continue
            targets.append({
                "sub_id":      r["sub_id"],
                "entity_type": r["entity_type"],
                "entity_name": r["entity_name"],
                "tier":        r["tier"],
                "phone":       r["phone"],
                "step":        due_step,
                "days_since_trial": days,
            })

        # Latch — bump grace_sms_step in the same tx so a retry can't
        # re-send. Per-sub because different subs land on different steps.
        for t in targets:
            cur.execute(
                "UPDATE payment_db.subscriptions SET grace_sms_step=%s WHERE id=%s",
                (t["step"], t["sub_id"]),
            )
        if targets:
            conn.commit()
        return {"targets": targets}
    finally:
        conn.close()


@router.post("/internal/grace-hard-cap")
def grace_hard_cap():
    """Pause corp ads whose grace window has closed (spec B3).

    Runs daily. Sets ads.active=FALSE and paused_by='grace_hard_cap'
    for every ad owned by a corp whose grace has expired. Idempotent —
    only touches ads that are still active. Renewal path in
    /payments/subscriptions/start restores paused ads back to active.
    """
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT s.entity_id
                 FROM payment_db.subscriptions s
                WHERE s.status='trialing'
                  AND s.entity_type='corporation'
                  AND s.grace_ends_at IS NOT NULL
                  AND s.grace_ends_at <= NOW()"""
        )
        ids = [r["entity_id"] for r in cur.fetchall()]
        if not ids:
            return {"paused": 0}
        ph = ",".join(["%s"] * len(ids))
        cur.execute(
            f"""UPDATE ads SET active=FALSE, paused_by='grace_hard_cap'
                 WHERE owner_entity_id IN ({ph})
                   AND active=TRUE
                   AND deleted_at IS NULL
                   AND (paused_by IS NULL OR paused_by='grace_hard_cap')""",
            ids,
        )
        n = cur.rowcount
        conn.commit()
        return {"paused": n}
    finally:
        conn.close()


@router.get("/{ad_id}/contact-reveal")
async def contact_reveal(
    ad_id: str,
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    if not x_entity_id or not x_entity_type:
        raise HTTPException(status_code=401, detail="auth_required")

    # 1. Entitlement + tier
    try:
        ent = fetch_entitlement(x_entity_id, x_entity_type)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail=f"entitlement_service_unreachable: {e}")
    if not ent["entitled"]:
        raise HTTPException(status_code=402, detail={
            "code": "subscription_required", "tier": ent["tier"], "status": ent["status"],
        })

    # 1b. Monthly reveal quota — enforced only if tier has a cap.
    limits = tier_limits(ent["tier"], "corporation")
    if limits["reveals_per_month"] is not None:
        _conn = get_db()
        try:
            _cur = _conn.cursor()
            _cur.execute(
                """SELECT COUNT(*) AS n FROM contact_reveals
                    WHERE viewer_entity_id=%s AND viewer_entity_type=%s
                      AND revealed_at >= DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00')""",
                (x_entity_id, x_entity_type),
            )
            row = _cur.fetchone()
            used = int(row["n"] if row else 0)
        finally:
            _conn.close()
        if used >= limits["reveals_per_month"]:
            raise HTTPException(status_code=402, detail={
                "code":  "tier_reveal_limit",
                "tier":  ent["tier"],
                "limit": limits["reveals_per_month"],
                "used":  used,
            })

    # 2. Fetch ad + owning corp
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT a.owner_entity_id, a.title_he,
                      c.company_name_he, c.company_name,
                      c.contact_phone, c.contact_email
                 FROM ads a
                 JOIN corporations c ON c.id = a.owner_entity_id
                WHERE a.id = %s AND a.deleted_at IS NULL""",
            (ad_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="ad_not_found")

        # 3. Audit — powers per-tier quota + reveals-received counters.
        cur.execute("SHOW TABLES LIKE 'contact_reveals'")
        if cur.fetchone():
            cur.execute(
                """INSERT INTO contact_reveals
                     (id, viewer_entity_id, viewer_entity_type, ad_id, revealed_at)
                   VALUES (%s, %s, %s, %s, NOW())""",
                (str(uuid.uuid4()), x_entity_id, x_entity_type, ad_id),
            )
            conn.commit()

        company_name = row["company_name_he"] or row["company_name"]
        response = {
            "ad_id":        ad_id,
            "company_name": company_name,
            "phone":        row["contact_phone"],
            "email":        row["contact_email"],
        }
    finally:
        conn.close()

    # 4. Notify the corp — best-effort, never blocks the reveal.
    if row["contact_phone"]:
        try:
            await publish_event("ad.contact_revealed", {
                "corp_id":       row["owner_entity_id"],
                "corp_phone":    row["contact_phone"],
                "corp_name":     company_name,
                "ad_id":         ad_id,
                "ad_title":      row["title_he"],
                "viewer_type":   x_entity_type,   # 'contractor' | 'corporation'
            })
        except Exception as e:
            print(f"[ads.contact_reveal] publish failed (non-fatal): {e}")

    return response


# ─── POST /ads/{id}/boost ───────────────────────────────────────────────────

@router.post("/{ad_id}/boost")
def boost_ad(
    ad_id: str,
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    corp_id = _require_corp(x_entity_id, x_entity_type)

    try:
        ent = fetch_entitlement(corp_id, "corporation")
    except httpx.HTTPError:
        raise HTTPException(status_code=503, detail="entitlement_service_unreachable")
    if not ent["entitled"]:
        raise HTTPException(status_code=402, detail={"code": "subscription_required", "tier": ent["tier"], "status": ent["status"]})
    if not tier_limits(ent["tier"], "corporation")["can_boost"]:
        raise HTTPException(status_code=402, detail={
            "code": "tier_boost_not_allowed", "tier": ent["tier"],
            "message": "שדרג ל'מתקדם' או 'פרו' כדי לקדם מודעות",
        })

    now   = datetime.utcnow()
    until = now + timedelta(days=BOOST_DAYS)
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE ads SET featured_until=%s WHERE id=%s AND owner_entity_id=%s AND deleted_at IS NULL",
            (until, ad_id, corp_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="ad_not_found")

        # D1 — write to promotions too so ROI attribution + billing
        # sourcing can move to that table without a schema change.
        # Read paths still use ads.featured_until until Wave 5 (D2)
        # swaps them over. Wrapped in try/except so a missing table
        # (fresh DB / pre-064 environment) doesn't 500 the boost.
        try:
            cur.execute(
                """INSERT INTO promotions
                     (id, kind, target_type, target_id,
                      owner_entity_id, owner_entity_type,
                      starts_at, ends_at, price_nis, status)
                   VALUES (%s, 'boost', 'ad', %s, %s, 'corporation',
                           %s, %s, %s, 'active')""",
                (str(uuid.uuid4()), ad_id, corp_id, now, until, BOOST_TOTAL_NIS),
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[boost] promotions insert skipped: {exc}")

        conn.commit()
        return {"id": ad_id, "featured_until": until.isoformat()}
    finally:
        conn.close()
