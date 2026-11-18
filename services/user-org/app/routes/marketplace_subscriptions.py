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

R33 B.3 · service providers buy here too, to add a category after
registration. During the launch promo their purchase writes the same
promo row registration writes (services/provider_plans.py) and charges
nothing, with or without PAYMENT_FAKE_MODE.

R37 4.1.2 · after the promo a provider's plan is paid for. This route
still decides whether the purchase may happen. When it may, it writes
the purchase down (payment_db.marketplace_charges, with the tier row's
price) and asks the payment service to charge the provider's card. The
payment service writes the plan row itself, and only after Cardcom
confirmed the charge. A declined card, a missing card or an unreachable
Cardcom leave no plan. Contractors and corporations are where they
were: no online payment for them here, 503.

R34 5a · the plan's owner can also manage it: turn renewal back on,
move to a bigger plan in the same category, and cancel. An upgrade is
free while the launch promo runs. Afterwards it is refused: what moving
to a bigger plan costs in the middle of a paid period has not been
decided. Cancelling is offered only for a plan nothing was paid for,
because what a paid plan is owed on cancellation has not been decided
either.
"""
import hashlib
import os
import uuid
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, Field
from decimal import Decimal

from app.db import get_db
from app.services import vat
from app.services.listing_attributes import parse_schema
from app.services.provider_plans import (
    PROVIDER_BLOCKED_CATEGORIES, insert_promo_plan, is_paid_tier, launch_promo_end,
)

router = APIRouter()

PAYMENT_FAKE_MODE = os.getenv("PAYMENT_FAKE_MODE", "0") == "1"
PAYMENT_SVC = os.getenv("PAYMENT_SERVICE_URL", "http://payment:3009")
# Where a purchase that has to be paid for is written down. The payment
# service charges from this row and nothing else (migration 104).
CHARGES_TABLE = "payment_db.marketplace_charges"
# Cardcom is given 15 seconds by the payment service; this is the wait
# for the whole exchange.
PAYMENT_WAIT_SECONDS = 40.0

# The answer wherever a charge would be needed: buying a plan, and
# moving to a bigger one once the launch promo is over.
_NO_ONLINE_PAYMENT = {
    "code": "cardcom_not_configured",
    "message": "תשלום אונליין עדיין לא הופעל בסביבה זו. פנה למנהל המערכת.",
}


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
    # U7 §2b — providers get a free subscription row (created on
    # register) so they can appear in this table; leaving them out
    # of the whitelist would return 403 on the plans list.
    if not entity_id or entity_type not in ("contractor", "corporation", "service_provider"):
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
        elif entity_type == "service_provider":
            # R33 B.3 · until now a provider fell into the contractor
            # branch below, was looked up in the contractors table and
            # got 404 contractor_not_found from quote and purchase.
            # Providers are active from registration; only a suspended
            # or removed one is turned away.
            cur.execute(
                "SELECT status FROM org_db.service_providers WHERE id=%s AND deleted_at IS NULL",
                (entity_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="provider_not_found")
            if row["status"] != "active":
                raise HTTPException(
                    status_code=403,
                    detail={
                        "code": "advertiser_not_approved",
                        "message": "חשבון הספק אינו פעיל. פנה לתמיכה.",
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


def _own_running_plan(cur, sub_id: str, entity_type: str, entity_id: str) -> dict:
    """The caller's plan `sub_id`, if it is still running. 404 when it
    is not the caller's, 409 when it has ended or was cancelled."""
    cur.execute(
        """SELECT s.*, (s.status = 'active' AND s.expires_at > NOW()) AS is_current
             FROM marketplace_subscriptions s
            WHERE s.id = %s
              AND s.advertiser_entity_type = %s
              AND s.advertiser_entity_id   = %s""",
        (sub_id, entity_type, entity_id),
    )
    plan = cur.fetchone()
    if not plan:
        raise HTTPException(status_code=404, detail="subscription_not_found")
    if not plan["is_current"]:
        raise HTTPException(
            status_code=409,
            detail={"code": "subscription_not_active", "message": "המסלול הזה כבר אינו פעיל."},
        )
    return plan


def _require_provider_can_buy(tier: dict):
    """R33 B.3 · what a provider may hold a plan in. `tier` needs
    category_code, price_nis and is_active (the tier's own flag)."""
    if tier["category_code"] in PROVIDER_BLOCKED_CATEGORIES:
        raise HTTPException(
            status_code=403,
            detail={
                "code":    "provider_category_forbidden",
                "message": "ספק שירות אינו יכול לפרסם בקטגוריה זו. יש לבחור קטגוריה אחרת.",
                "category": tier["category_code"],
            },
        )
    # A price of 0 is an admin-only override; no picker offers it, and
    # registration refuses it for the same reason.
    if not is_paid_tier(tier):
        raise HTTPException(status_code=410, detail="tier_unavailable")


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


# ── A purchase that is paid for ───────────────────────────────────────

_NOT_ACTIVATED = "המסלול לא הופעל."


def _payment_refusal(resp) -> dict:
    """The payment service's own answer, code and Hebrew message, when it
    gave one."""
    try:
        error = resp.json().get("error") or {}
    except ValueError:
        error = {}
    details = error.get("details")
    if isinstance(details, dict) and details.get("message"):
        return details
    return {"code": "payment_failed", "message": f"התשלום לא בוצע. {_NOT_ACTIVATED}"}


def _buy_with_charge(conn, cur, entity_type: str, entity_id: str, tier: dict, auto_renew: bool) -> dict:
    """R37 4.1.2 · write the purchase down, have it charged, and answer
    with the plan the payment service activated.

    `tier` is the row the caller already checked. Its price is the
    amount; nothing from the request is.
    """
    # One purchase at a time per advertiser and category, so that two
    # clicks cannot both get past the "no plan here yet" check and both
    # be charged.
    lock = "mpbuy:" + hashlib.sha1(
        f"{entity_type}:{entity_id}:{tier['category_code']}".encode()
    ).hexdigest()
    cur.execute("SELECT GET_LOCK(%s, 0) AS got", (lock,))
    if not (cur.fetchone() or {}).get("got"):
        raise HTTPException(
            status_code=409,
            detail={"code": "purchase_in_progress",
                    "message": "רכישת מסלול בקטגוריה זו כבר מתבצעת. המתינו לסיומה."},
        )
    try:
        # Asked again, holding the lock, on a fresh read: the check the
        # caller made may be older than a purchase that just finished.
        conn.rollback()
        if _get_active_subscription(cur, entity_type, entity_id, tier["category_code"]):
            raise HTTPException(status_code=409, detail="already_subscribed_to_category")

        # Fixes ג item 6 · the tier price is before VAT; the row carries
        # the price, the VAT and the total, and the total is what is charged.
        try:
            money = vat.for_price(cur, tier["price_nis"])
        except vat.VatPeriodMissing:
            raise HTTPException(
                status_code=503,
                detail={"code": "vat_period_missing",
                        "message": f"שיעור המע\"מ אינו מוגדר. {_NOT_ACTIVATED} פנו לתמיכה."},
            )
        charge_id = str(uuid.uuid4())
        cur.execute(
            f"""INSERT INTO {CHARGES_TABLE}
                    (id, kind, entity_type, entity_id, tier_id, category_code,
                     slot_count, duration_days, amount_nis, net_amount_nis, vat_percent,
                     vat_amount_nis, auto_renew, status)
                VALUES (%s, 'purchase', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending')""",
            (charge_id, entity_type, entity_id, tier["id"], tier["category_code"],
             tier["slot_count"], tier["duration_days"], money["total"], money["net"],
             money["percent"], money["vat"], auto_renew),
        )
        conn.commit()

        try:
            resp = httpx.post(
                f"{PAYMENT_SVC}/payments/marketplace/charges/{charge_id}/pay",
                headers={"x-entity-id": entity_id, "x-entity-type": entity_type},
                timeout=PAYMENT_WAIT_SECONDS,
            )
        except httpx.HTTPError:
            # No answer. The charge may still have gone through, in which
            # case the plan is there; the message says where to look.
            raise HTTPException(
                status_code=502,
                detail={"code": "payment_no_answer",
                        "message": "לא התקבלה תשובה משירות התשלומים. "
                                   "לפני ניסיון נוסף כדאי לבדוק בעמוד מנוי ותשלום אם המסלול נוסף."},
            )

        if resp.status_code in (402, 502, 503):
            detail = _payment_refusal(resp)
            if detail.get("code") == "no_payment_method":
                detail["add_card_url"] = "/provider/billing"
            raise HTTPException(status_code=resp.status_code, detail=detail)
        paid = resp.json() if resp.status_code == 200 else {}
        if paid.get("status") != "charged" or not paid.get("subscription_id"):
            raise HTTPException(
                status_code=502,
                detail={"code": "payment_failed", "message": f"התשלום לא הושלם. {_NOT_ACTIVATED}"},
            )

        conn.rollback()   # a fresh read: the plan row was written by the payment service
        cur.execute("SELECT * FROM marketplace_subscriptions WHERE id=%s", (paid["subscription_id"],))
        plan = _serialize(cur.fetchone())
        plan["charged_nis"] = paid.get("amount_nis")
        plan["charged_vat_nis"] = paid.get("vat_amount_nis")
        plan["invoice_number"] = paid.get("invoice_number")
        plan["invoice_url"] = paid.get("invoice_url")
        return plan
    finally:
        cur.execute("SELECT RELEASE_LOCK(%s)", (lock,))
        cur.fetchone()


# ── Request models ───────────────────────────────────────────────────

class QuoteRequest(BaseModel):
    tier_id: str = Field(min_length=1)


class PurchaseRequest(BaseModel):
    tier_id:    str  = Field(min_length=1)
    auto_renew: bool = True


class UpgradeRequest(BaseModel):
    tier_id: str = Field(min_length=1)


# ── GET /marketplace/subscriptions/catalog ───────────────────────────
# Active categories with their active tiers, in one call. Public: the
# provider sign-up page shows the plans to a visitor who has no account
# yet, and the listing forms read the category list from it.
#
# R33 A1 · this lived at /marketplace/admin/catalog, the one route in
# the admin router with no admin gate. It only worked for the public
# because GET under /api/marketplace is public and that rule reached
# into the admin prefix. Closing that hole closed this route with it,
# so it moved here, to a path that says what it is.

@router.get("/subscriptions/catalog")
def public_catalog():
    """Return active categories with their active tiers (no auth — the
    flow checks subscription state separately on purchase)."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT c.code, c.name_he, c.name_en, c.name_ar, c.icon_slug, c.sort_order,
                      c.field_schema
                 FROM marketplace_categories c
                WHERE c.is_active = TRUE
                ORDER BY c.sort_order, c.code"""
        )
        cats = [_serialize(r) for r in cur.fetchall()]
        # R34 4c · what each category asks of a listing, for the form.
        for c in cats:
            c["field_schema"] = parse_schema(c.get("field_schema"))
        if not cats:
            return []

        codes = tuple(c["code"] for c in cats)
        placeholders = ",".join(["%s"] * len(codes))
        cur.execute(
            f"""SELECT id, category_code, name_he, name_en, slot_count, duration_days,
                       price_nis, sort_order
                  FROM marketplace_subscription_tiers
                 WHERE is_active = TRUE AND category_code IN ({placeholders})
                 ORDER BY sort_order, price_nis""",
            codes,
        )
        by_cat: dict[str, list] = {}
        for row in cur.fetchall():
            by_cat.setdefault(row["category_code"], []).append(_serialize(row))
        for c in cats:
            c["tiers"] = by_cat.get(c["code"], [])
        return cats
    finally:
        conn.close()


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

        # R33 B.3 · for a provider: is this a plan it may hold, and is
        # the launch promo on. `promo_end` tells the page whether the
        # purchase will be charged now (None) or runs free until that
        # date, so the provider reads it before confirming.
        promo_end = None
        if entity_type == "service_provider":
            _require_provider_can_buy({
                "category_code": row["category_code"],
                "price_nis":     row["price_nis"],
                "is_active":     row["tier_active"],
            })
            promo_end = launch_promo_end(cur)

        # If they already have an active subscription for this category we
        # surface it so the UI can show "renew/upgrade" instead of "buy".
        existing = _get_active_subscription(cur, entity_type, entity_id, row["category_code"])

        # Fixes ג item 6 · what the confirm step shows: the price before
        # VAT, the VAT and the total that will be charged.
        try:
            money = vat.as_json(vat.for_price(cur, row["price_nis"]))
        except vat.VatPeriodMissing:
            money = None

        return {
            "tier":            _serialize({k: row[k] for k in (
                "tier_id","name_he","name_en","slot_count","duration_days","price_nis",
                "category_code","category_name_he",
            )}),
            "existing_subscription": _serialize(existing) if existing else None,
            "advertiser": {"entity_type": entity_type, "entity_id": entity_id},
            "promo_end": promo_end.strftime("%Y-%m-%d") if promo_end else None,
            "vat": money,
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
    """Buy a plan.

    A provider during the launch promo: the promo row, nothing charged.
    A provider after it: the card on file is charged the tier's price
    and the plan is activated only if the charge succeeds (R37 4.1.2).
    A contractor or corporation: no online payment here yet, 503 (the
    PAYMENT_FAKE_MODE branch below is for local work only).
    """
    entity_type, entity_id = _resolve_advertiser(x_entity_id, x_entity_type, x_org_id)
    _require_advertiser_approved(entity_type, entity_id)

    conn = get_db()
    try:
        cur = conn.cursor()

        # Resolve the tier and snapshot its values onto the subscription
        # row — admin tier edits later won't retroactively change quota
        # or end-date for already-paid subscriptions.
        cur.execute(
            """SELECT t.id, t.category_code, t.slot_count, t.duration_days, t.price_nis,
                      t.is_active AS tier_active, c.is_active AS category_active
                 FROM marketplace_subscription_tiers t
                 JOIN marketplace_categories c ON c.code = t.category_code
                WHERE t.id = %s""",
            (body.tier_id,),
        )
        tier = cur.fetchone()
        if not tier:
            raise HTTPException(status_code=404, detail="tier_not_found")
        if not tier["tier_active"] or not tier["category_active"]:
            raise HTTPException(status_code=410, detail="tier_unavailable")
        if entity_type == "service_provider":
            _require_provider_can_buy({**tier, "is_active": tier["tier_active"]})

        # Block buying a second active subscription for the same category.
        # The advertiser should "upgrade" by buying a different tier after
        # the current one expires (or by cancelling first).
        if _get_active_subscription(cur, entity_type, entity_id, tier["category_code"]):
            raise HTTPException(status_code=409, detail="already_subscribed_to_category")

        # R33 B.3 · a provider adding a category during the launch promo
        # gets the row registration would have written: nothing charged,
        # the tier's price kept as a snapshot, the plan running until
        # the promo ends. No payment is involved, so PAYMENT_FAKE_MODE
        # does not come into it.
        promo_end = launch_promo_end(cur) if entity_type == "service_provider" else None
        if promo_end:
            sub_id = insert_promo_plan(cur, entity_id, tier, promo_end)
            conn.commit()
            cur.execute("SELECT * FROM marketplace_subscriptions WHERE id=%s", (sub_id,))
            return _serialize(cur.fetchone())

        # R37 4.1.2 · the promo is over and the plan is paid for.
        if entity_type == "service_provider":
            return _buy_with_charge(conn, cur, entity_type, entity_id, tier, bool(body.auto_renew))

        # A contractor or a corporation has to pay too, and there is no
        # charging for them here. Checked after the request is known to
        # be a valid one, so a bad tier id reads as a bad tier id.
        if not PAYMENT_FAKE_MODE:
            raise HTTPException(status_code=503, detail=_NO_ONLINE_PAYMENT)

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
            """SELECT s.*, c.name_he AS category_name_he, c.name_en AS category_name_en,
                      t.name_he AS tier_name_he,
                      (s.status = 'active' AND s.expires_at > NOW()) AS is_current
                 FROM marketplace_subscriptions s
                 JOIN marketplace_categories c ON c.code = s.category_code
                 LEFT JOIN marketplace_subscription_tiers t ON t.id = s.tier_id
                WHERE s.advertiser_entity_type = %s
                  AND s.advertiser_entity_id   = %s
                ORDER BY (s.status='active') DESC, s.expires_at DESC""",
            (entity_type, entity_id),
        )
        rows = [_serialize(r) for r in cur.fetchall()]

        # Annotate active subscriptions with current slot usage
        for r in rows:
            # R34 5a · `status` stays 'active' after expires_at passes
            # (nothing flips it), so a page that reads `status` alone
            # shows a lapsed plan as running. `is_current` is the test
            # publishing itself applies.
            r["is_current"] = bool(r["is_current"])
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


# ── POST /marketplace/my/subscriptions/{id}/auto-renew ──────────────

@router.post("/my/subscriptions/{sub_id}/auto-renew", status_code=204)
def enable_auto_renew(
    sub_id: str,
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
    x_org_id:      Optional[str] = Header(default=None),
):
    """R34 5a · turn renewal back on, on a plan that is still running."""
    entity_type, entity_id = _resolve_advertiser(x_entity_id, x_entity_type, x_org_id)

    conn = get_db()
    try:
        cur = conn.cursor()
        _own_running_plan(cur, sub_id, entity_type, entity_id)
        cur.execute(
            "UPDATE marketplace_subscriptions SET auto_renew = TRUE WHERE id = %s",
            (sub_id,),
        )
        conn.commit()
    finally:
        conn.close()


# ── POST /marketplace/my/subscriptions/{id}/upgrade ─────────────────

@router.post("/my/subscriptions/{sub_id}/upgrade")
def upgrade_subscription(
    sub_id: str,
    body: UpgradeRequest,
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
    x_org_id:      Optional[str] = Header(default=None),
):
    """R34 5a · move a running plan to a bigger tier of its category.

    The plan row is kept: its listings stay linked to it and its end
    date does not move. Only the tier, the slot count and the price
    snapshot change.

    A provider during the launch promo pays nothing, as it would have
    paid nothing had it picked this tier at registration. After the
    promo the move would have to be paid for, and what it costs in the
    middle of a paid period is not decided: refused, 409, for a
    provider. A contractor or corporation gets 503 as before.
    """
    entity_type, entity_id = _resolve_advertiser(x_entity_id, x_entity_type, x_org_id)
    _require_advertiser_approved(entity_type, entity_id)

    conn = get_db()
    try:
        cur = conn.cursor()
        plan = _own_running_plan(cur, sub_id, entity_type, entity_id)

        cur.execute(
            """SELECT t.id, t.category_code, t.slot_count, t.duration_days, t.price_nis,
                      t.is_active AS tier_active, c.is_active AS category_active
                 FROM marketplace_subscription_tiers t
                 JOIN marketplace_categories c ON c.code = t.category_code
                WHERE t.id = %s""",
            (body.tier_id,),
        )
        tier = cur.fetchone()
        if not tier:
            raise HTTPException(status_code=404, detail="tier_not_found")
        if not tier["tier_active"] or not tier["category_active"]:
            raise HTTPException(status_code=410, detail="tier_unavailable")
        if tier["category_code"] != plan["category_code"]:
            raise HTTPException(
                status_code=409,
                detail={"code": "tier_category_mismatch", "message": "אפשר לשדרג רק למסלול באותה קטגוריה."},
            )
        if entity_type == "service_provider":
            _require_provider_can_buy({**tier, "is_active": tier["tier_active"]})
        # Bigger only. A smaller plan could leave more listings
        # published than it has room for, and nobody asked for that.
        if tier["slot_count"] <= plan["slot_count"]:
            raise HTTPException(
                status_code=409,
                detail={"code": "not_an_upgrade", "message": "שדרוג אפשרי רק למסלול עם יותר מודעות."},
            )

        promo_end = launch_promo_end(cur) if entity_type == "service_provider" else None
        if not promo_end:
            if entity_type == "service_provider":
                raise HTTPException(
                    status_code=409,
                    detail={"code": "paid_upgrade_unsupported",
                            "message": "שדרוג של מסלול בתשלום אינו זמין כרגע. פנו לתמיכה."},
                )
            raise HTTPException(status_code=503, detail=_NO_ONLINE_PAYMENT)

        cur.execute(
            """UPDATE marketplace_subscriptions
                  SET tier_id = %s, slot_count = %s, duration_days = %s, price_nis = %s
                WHERE id = %s""",
            (tier["id"], tier["slot_count"], tier["duration_days"], tier["price_nis"], sub_id),
        )
        conn.commit()

        cur.execute("SELECT * FROM marketplace_subscriptions WHERE id=%s", (sub_id,))
        return _serialize(cur.fetchone())
    finally:
        conn.close()


# ── POST /marketplace/my/subscriptions/{id}/cancel ──────────────────

@router.post("/my/subscriptions/{sub_id}/cancel")
def cancel_subscription(
    sub_id: str,
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
    x_org_id:      Optional[str] = Header(default=None),
):
    """R34 5a · end a running plan now.

    An advertiser publishes in a category only while it has a running
    plan there (R33 B), so the listings on this plan stop being
    published with it. They are paused, not deleted: the owner can
    publish them again once a plan in the category has room.
    """
    entity_type, entity_id = _resolve_advertiser(x_entity_id, x_entity_type, x_org_id)

    conn = get_db()
    try:
        cur = conn.cursor()
        plan = _own_running_plan(cur, sub_id, entity_type, entity_id)
        # Ending a plan that was paid for raises a question nobody has
        # answered (does it run to the end of the period, is anything
        # returned). Promo plans carry no payment reference.
        if plan.get("cardcom_token_ref") or plan.get("payment_transaction_id"):
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "paid_plan_cancel_unsupported",
                    "message": "ביטול מסלול ששולם אינו זמין כאן. פנה לתמיכה.",
                },
            )

        cur.execute(
            """UPDATE marketplace_listings
                  SET status = 'paused'
                WHERE subscription_id = %s
                  AND deleted_at IS NULL
                  AND status = 'active'""",
            (sub_id,),
        )
        paused = cur.rowcount
        cur.execute(
            """UPDATE marketplace_subscriptions
                  SET status = 'cancelled', cancelled_at = NOW(), auto_renew = FALSE
                WHERE id = %s""",
            (sub_id,),
        )
        conn.commit()
        return {"id": sub_id, "status": "cancelled", "listings_paused": paused}
    finally:
        conn.close()
