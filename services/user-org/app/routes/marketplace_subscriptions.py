"""
Marketplace subscriptions — advertiser-facing.

Buying a subscription unlocks N concurrent active listings in a chosen
category for D days. Until real Cardcom creds are wired in production,
purchases activate the subscription instantly with no payment redirect
(behind PAYMENT_FAKE_MODE — the same flag the deal flow already uses).
When Cardcom J4 creds land, the `purchase` endpoint will be split into:
  POST /subscriptions/checkout  → returns a Cardcom URL (pending row)
  webhook                       → activates on ResponseCode=0
That swap is intentionally local to this file.
"""
import os
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, Field
from decimal import Decimal

from app.db import get_db

router = APIRouter()

PAYMENT_FAKE_MODE = os.getenv("PAYMENT_FAKE_MODE", "0") == "1"


# ── Helpers ──────────────────────────────────────────────────────────

def _resolve_advertiser(
    x_entity_id: Optional[str],
    x_entity_type: Optional[str],
    x_org_id: Optional[str],
) -> tuple[str, str]:
    """Pull the advertiser identity from gateway-injected headers and
    enforce that the caller belongs to a business that can publish."""
    entity_id = x_entity_id or x_org_id
    entity_type = (x_entity_type or "").lower()
    if not entity_id or entity_type not in ("contractor", "corporation"):
        raise HTTPException(status_code=403, detail="advertiser_required")
    return entity_type, entity_id


def _require_advertiser_approved(entity_type: str, entity_id: str):
    """Only fully-approved businesses can buy subscriptions or publish.
    Mirrors the gates used elsewhere in the codebase (worker publishing,
    deal lifecycle): tier_2 for contractors, approval_status='approved'
    for corporations."""
    conn = get_db()
    try:
        cur = conn.cursor()
        if entity_type == "corporation":
            cur.execute(
                "SELECT approval_status FROM org_db.corporations WHERE id=%s AND deleted_at IS NULL",
                (entity_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="corporation_not_found")
            if row["approval_status"] != "approved":
                raise HTTPException(
                    status_code=403,
                    detail={
                        "code": "advertiser_not_approved",
                        "message": "פרסום בשוק מותר רק לעסקים מאושרים. אישור התאגיד מבוצע על ידי מנהל המערכת.",
                    },
                )
        else:  # contractor
            cur.execute(
                "SELECT verification_tier FROM org_db.contractors WHERE id=%s AND deleted_at IS NULL",
                (entity_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="contractor_not_found")
            if row["verification_tier"] != "tier_2":
                raise HTTPException(
                    status_code=403,
                    detail={
                        "code": "advertiser_not_approved",
                        "message": "פרסום בשוק מותר רק לעסקים מאומתים. השלם את אימות העסק כדי להפעיל את האפשרות.",
                    },
                )
    finally:
        conn.close()


def _get_active_subscription(
    cur, entity_type: str, entity_id: str, category_code: str,
) -> Optional[dict]:
    """Returns the active subscription row, or None. An advertiser can
    hold at most one ACTIVE subscription per category at a time —
    expired/cancelled rows are kept for billing history."""
    cur.execute(
        """SELECT * FROM marketplace_subscriptions
            WHERE advertiser_entity_type = %s
              AND advertiser_entity_id   = %s
              AND category_code          = %s
              AND status                 = 'active'
              AND expires_at             > NOW()
            ORDER BY expires_at DESC LIMIT 1""",
        (entity_type, entity_id, category_code),
    )
    return cur.fetchone()


def _count_active_listings(cur, subscription_id: str) -> int:
    cur.execute(
        """SELECT COUNT(*) AS n FROM marketplace_listings
            WHERE subscription_id = %s
              AND deleted_at IS NULL
              AND status = 'active'""",
        (subscription_id,),
    )
    row = cur.fetchone()
    return int(row["n"] if row else 0)


def _serialize(row: dict) -> dict:
    out = {}
    for k, v in row.items():
        if hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        elif isinstance(v, Decimal):
            out[k] = float(v)
        else:
            out[k] = v
    return out


# ── Request models ───────────────────────────────────────────────────

class QuoteRequest(BaseModel):
    tier_id: str = Field(min_length=1)


class PurchaseRequest(BaseModel):
    tier_id:    str  = Field(min_length=1)
    auto_renew: bool = True


# ── POST /marketplace/subscriptions/quote ────────────────────────────

@router.post("/subscriptions/quote")
def quote_subscription(
    body: QuoteRequest,
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
    x_org_id:      Optional[str] = Header(default=None),
):
    """Preview the price + activation date for a tier. No payment yet.
    Lets the UI show 'sub will be active until DD/MM/YYYY for ₪X' before
    the user commits."""
    entity_type, entity_id = _resolve_advertiser(x_entity_id, x_entity_type, x_org_id)
    _require_advertiser_approved(entity_type, entity_id)

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT t.id AS tier_id, t.name_he, t.name_en,
                      t.slot_count, t.duration_days, t.price_nis,
                      t.is_active AS tier_active,
                      c.code AS category_code, c.name_he AS category_name_he,
                      c.is_active AS category_active
                 FROM marketplace_subscription_tiers t
                 JOIN marketplace_categories c ON c.code = t.category_code
                WHERE t.id = %s""",
            (body.tier_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="tier_not_found")
        if not row["tier_active"] or not row["category_active"]:
            raise HTTPException(status_code=410, detail="tier_unavailable")

        # If they already have an active subscription for this category we
        # surface it so the UI can show "renew/upgrade" instead of "buy".
        existing = _get_active_subscription(cur, entity_type, entity_id, row["category_code"])

        return {
            "tier":            _serialize({k: row[k] for k in (
                "tier_id","name_he","name_en","slot_count","duration_days","price_nis",
                "category_code","category_name_he",
            )}),
            "existing_subscription": _serialize(existing) if existing else None,
            "advertiser": {"entity_type": entity_type, "entity_id": entity_id},
        }
    finally:
        conn.close()


# ── POST /marketplace/subscriptions ──────────────────────────────────

@router.post("/subscriptions", status_code=201)
def purchase_subscription(
    body: PurchaseRequest,
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
    x_org_id:      Optional[str] = Header(default=None),
):
    """Create + activate a subscription.

    PAYMENT_FAKE_MODE path (current): instantly activates with no
    payment redirect. Useful for staging + local until real Cardcom
    creds are provisioned.

    Real-Cardcom path (future): create a 'pending' subscription, return
    a Cardcom LowProfile URL, activate via webhook on ResponseCode=0.
    """
    entity_type, entity_id = _resolve_advertiser(x_entity_id, x_entity_type, x_org_id)
    _require_advertiser_approved(entity_type, entity_id)

    if not PAYMENT_FAKE_MODE:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "cardcom_not_configured",
                "message": "תשלום אונליין עדיין לא הופעל בסביבה זו. פנה למנהל המערכת.",
            },
        )

    conn = get_db()
    try:
        cur = conn.cursor()

        # Resolve the tier and snapshot its values onto the subscription
        # row — admin tier edits later won't retroactively change quota
        # or end-date for already-paid subscriptions.
        cur.execute(
            """SELECT id, category_code, slot_count, duration_days, price_nis,
                      is_active AS tier_active
                 FROM marketplace_subscription_tiers WHERE id = %s""",
            (body.tier_id,),
        )
        tier = cur.fetchone()
        if not tier:
            raise HTTPException(status_code=404, detail="tier_not_found")
        if not tier["tier_active"]:
            raise HTTPException(status_code=410, detail="tier_unavailable")

        # Block buying a second active subscription for the same category.
        # The advertiser should "upgrade" by buying a different tier after
        # the current one expires (or by cancelling first).
        if _get_active_subscription(cur, entity_type, entity_id, tier["category_code"]):
            raise HTTPException(status_code=409, detail="already_subscribed_to_category")

        sub_id = str(uuid.uuid4())
        # FAKE-mode payment marker — replaced with real cardcom_token_ref
        # in the future-Cardcom path.
        fake_token_ref = f"FAKE-{uuid.uuid4().hex[:12].upper()}"

        cur.execute(
            """INSERT INTO marketplace_subscriptions
                   (id, advertiser_entity_type, advertiser_entity_id,
                    category_code, tier_id, slot_count, duration_days, price_nis,
                    expires_at, auto_renew, status, cardcom_token_ref)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,
                       DATE_ADD(NOW(), INTERVAL %s DAY),
                       %s, 'active', %s)""",
            (
                sub_id, entity_type, entity_id,
                tier["category_code"], tier["id"],
                tier["slot_count"], tier["duration_days"], tier["price_nis"],
                tier["duration_days"],
                bool(body.auto_renew),
                fake_token_ref,
            ),
        )
        conn.commit()

        cur.execute("SELECT * FROM marketplace_subscriptions WHERE id=%s", (sub_id,))
        return _serialize(cur.fetchone())
    finally:
        conn.close()


# ── GET /marketplace/my/subscriptions ────────────────────────────────

@router.get("/my/subscriptions")
def list_my_subscriptions(
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
    x_org_id:      Optional[str] = Header(default=None),
):
    """All of the caller's subscriptions (active + expired + cancelled)
    plus current slot usage on the active ones — drives the 'X/Y slots'
    banner in the listing form."""
    entity_type, entity_id = _resolve_advertiser(x_entity_id, x_entity_type, x_org_id)

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT s.*, c.name_he AS category_name_he, c.name_en AS category_name_en
                 FROM marketplace_subscriptions s
                 JOIN marketplace_categories c ON c.code = s.category_code
                WHERE s.advertiser_entity_type = %s
                  AND s.advertiser_entity_id   = %s
                ORDER BY (s.status='active') DESC, s.expires_at DESC""",
            (entity_type, entity_id),
        )
        rows = [_serialize(r) for r in cur.fetchall()]

        # Annotate active subscriptions with current slot usage
        for r in rows:
            if r["status"] == "active":
                r["slots_used"] = _count_active_listings(cur, r["id"])
                r["slots_available"] = max(0, r["slot_count"] - r["slots_used"])
            else:
                r["slots_used"] = 0
                r["slots_available"] = 0
        return rows
    finally:
        conn.close()


# ── DELETE /marketplace/my/subscriptions/{id} (cancel auto-renew) ───

@router.delete("/my/subscriptions/{sub_id}/auto-renew", status_code=204)
def cancel_auto_renew(
    sub_id: str,
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
    x_org_id:      Optional[str] = Header(default=None),
):
    """Stop auto-renewing — current subscription stays active until
    its expires_at, then expires naturally."""
    entity_type, entity_id = _resolve_advertiser(x_entity_id, x_entity_type, x_org_id)

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """UPDATE marketplace_subscriptions
                  SET auto_renew = FALSE
                WHERE id = %s
                  AND advertiser_entity_type = %s
                  AND advertiser_entity_id   = %s""",
            (sub_id, entity_type, entity_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="subscription_not_found")
        conn.commit()
    finally:
        conn.close()
