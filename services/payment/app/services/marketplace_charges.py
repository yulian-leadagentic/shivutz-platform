"""R37 4.1.2 · charging for a marketplace plan.

A marketplace plan is a row in org_db.marketplace_subscriptions. After
the launch promo a provider's plan has to be paid for, and the rule is
Yulian's (15.11): no plan is activated without a successful charge.

The purchase is checked by user-org, which owns the plans: is this
advertiser allowed to buy, is the tier on sale, does it hold a plan in
the category already. When all of that passes it writes a pending row
in payment_db.marketplace_charges with the tier's price and asks this
service to take the money: pay().

pay() charges the entity's card on file for the amount ON THAT ROW. It
takes no amount and no tier from the caller, so the route can be
reached by anyone through the gateway and still do only one thing:
charge a purchase user-org has already approved, for the entity that is
asking, once.

Only after Cardcom confirms the charge is the plan row written, in the
same database transaction that marks the charge as charged. A declined
card, an unreachable Cardcom or a missing card leave no plan behind.

The price is charged as it stands on the tier row, VAT inside it, the
way the contractor plans are charged (subscriptions.py: vat_amount=0).
"""
import logging
import uuid
from typing import Optional

from app.crypto import decrypt_token
from app.db import get_db
from app.services import cardcom, invoice_lines
from app.services.cardcom import (
    CardcomDeclinedError,
    CardcomNetworkError,
    charge_token,
    expiry_mmyy,
)
from app.services.payment_events import record_event

logger = logging.getLogger(__name__)

# The two schemas, named once. This service reaches the plans by a
# qualified name on its own connection, so that the plan row and the
# charge row change in one transaction.
PAY_DB = "payment_db"
ORG_DB = "org_db"


class ChargeRefused(Exception):
    """The purchase was not charged. `status` is the HTTP status to
    answer with, `detail` the body: a code and a Hebrew message."""
    def __init__(self, status: int, code: str, message: str, **extra):
        super().__init__(code)
        self.status = status
        self.detail = {"code": code, "message": message, **extra}


NOT_ACTIVATED = "המסלול לא הופעל."


def load(charge_id: str) -> Optional[dict]:
    conn = get_db(PAY_DB)
    try:
        cur = conn.cursor()
        cur.execute(f"SELECT * FROM {PAY_DB}.marketplace_charges WHERE id=%s", (charge_id,))
        return cur.fetchone()
    finally:
        conn.close()


def _claim(charge_id: str) -> bool:
    """Take a pending row for charging. False when it is no longer
    pending: someone else took it, or it is already settled."""
    conn = get_db(PAY_DB)
    try:
        cur = conn.cursor()
        cur.execute(
            f"""UPDATE {PAY_DB}.marketplace_charges
                   SET status='charging', is_fake=%s
                 WHERE id=%s AND status='pending'""",
            (cardcom.PAYMENT_FAKE_MODE, charge_id),
        )
        conn.commit()
        return cur.rowcount == 1
    finally:
        conn.close()


def _settle(charge_id: str, status: str, reason: Optional[str] = None, event_id: Optional[str] = None) -> None:
    conn = get_db(PAY_DB)
    try:
        cur = conn.cursor()
        cur.execute(
            f"""UPDATE {PAY_DB}.marketplace_charges
                   SET status=%s, failure_reason=%s, payment_event_id=COALESCE(%s, payment_event_id)
                 WHERE id=%s AND status='charging'""",
            (status, (reason or None) and reason[:255], event_id, charge_id),
        )
        conn.commit()
    finally:
        conn.close()


def default_card(entity_type: str, entity_id: str) -> Optional[dict]:
    conn = get_db(PAY_DB)
    try:
        cur = conn.cursor()
        cur.execute(
            f"""SELECT * FROM {PAY_DB}.payment_methods
                 WHERE entity_type=%s AND entity_id=%s
                   AND deleted_at IS NULL AND status='active'
                 ORDER BY is_default DESC, created_at DESC
                 LIMIT 1""",
            (entity_type, entity_id),
        )
        return cur.fetchone()
    finally:
        conn.close()


def invoice_data(charge: dict) -> dict:
    """Who the document is made out to, and its one line. Best effort:
    a missing name or address thins the document, it does not stop the
    charge."""
    name = email = tax_id = ""
    category = ""
    try:
        conn = get_db(ORG_DB)
        try:
            cur = conn.cursor()
            cur.execute(
                f"""SELECT c.name_he AS category_name
                      FROM {ORG_DB}.marketplace_subscription_tiers t
                      JOIN {ORG_DB}.marketplace_categories c ON c.code = t.category_code
                     WHERE t.id=%s""",
                (charge["tier_id"],),
            )
            names = cur.fetchone() or {}
            category = names.get("category_name") or ""
            if charge["entity_type"] == "service_provider":
                cur.execute(
                    f"SELECT name, email, business_number FROM {ORG_DB}.service_providers WHERE id=%s",
                    (charge["entity_id"],),
                )
                who = cur.fetchone() or {}
                name, email = who.get("name") or "", who.get("email") or ""
                number = (who.get("business_number") or "").strip()
                # Only a number that has the shape of one goes on the
                # document.
                tax_id = number if number.isdigit() and len(number) == 9 else ""
        finally:
            conn.close()
    except Exception as exc:  # noqa: BLE001
        logger.warning("[marketplace-charges] invoice details lookup failed: %s", exc)
    return {
        "customer_name":  name,
        "customer_email": email,
        "tax_id":         tax_id,
        "description":    invoice_lines.marketplace_plan(category),
    }


def _answer(charge: dict) -> dict:
    return {
        "charge_id":       charge["id"],
        "status":          charge["status"],
        "subscription_id": charge.get("subscription_id"),
        "amount_nis":      float(charge["amount_nis"]),
        "invoice_number":  charge.get("invoice_number"),
        "invoice_url":     charge.get("invoice_url"),
        "mode":            "fake" if charge.get("is_fake") else "real",
    }


async def pay(charge: dict) -> dict:
    """Charge a pending purchase and activate its plan.

    Returns the charge as it stands when it is already settled or being
    charged by another request: asking twice never charges twice.
    Raises ChargeRefused when nothing was charged.
    """
    if charge["status"] != "pending" or not _claim(charge["id"]):
        return _answer(load(charge["id"]))

    entity_type, entity_id = charge["entity_type"], charge["entity_id"]
    amount = float(charge["amount_nis"])
    audit = dict(entity_id=entity_id, entity_type=entity_type,
                 kind=f"marketplace_{charge['kind']}", amount_nis=int(round(amount)))

    # FREE_LAUNCH_UNTIL makes charge_token return a made-up "charged"
    # answer. A plan must not be activated on that: the provider promo
    # has its own date (site_settings.launch_promo_end), and once that
    # has passed a plan is paid for or not held.
    if cardcom._free_launch_active():
        _settle(charge["id"], "not_attempted", "free_launch_env_active")
        logger.error("[marketplace-charges] FREE_LAUNCH_UNTIL is still set on the payment service: purchase refused")
        raise ChargeRefused(503, "payment_not_live",
                            f"התשלום אינו זמין כרגע. {NOT_ACTIVATED} פנו לתמיכה.")

    card = default_card(entity_type, entity_id)
    if not card:
        _settle(charge["id"], "not_attempted", "no_payment_method")
        raise ChargeRefused(402, "no_payment_method",
                            f"אין כרטיס אשראי שמור. יש להוסיף כרטיס לפני רכישת מסלול. {NOT_ACTIVATED}")

    try:
        result = await charge_token(
            provider_token  = decrypt_token(card["provider_token"]),
            base_amount     = amount,
            vat_amount      = 0,   # the tier price is the whole price, VAT inside it
            deal_id         = f"mp:{charge['id']}",
            idempotency_key = charge["id"],
            invoice_data    = invoice_data(charge),
            card_expiry     = expiry_mmyy(card),
        )
    except CardcomDeclinedError as exc:
        said = (exc.description or "").strip()
        _, event_id = record_event(**audit, outcome="declined", provider_transaction_id=None,
                                   response_code=exc.code,
                                   raw={"error": str(exc), "charge_id": charge["id"]})
        _settle(charge["id"], "declined", said or str(exc), event_id)
        raise ChargeRefused(
            402, "card_declined",
            (f"החיוב לא אושר: {said}. " if said else "החיוב לא אושר על ידי חברת האשראי. ") + NOT_ACTIVATED,
            reason=said or None, response_code=exc.code,
        )
    except CardcomNetworkError as exc:
        _, event_id = record_event(**audit, outcome="error", provider_transaction_id=None,
                                   raw={"error": str(exc), "charge_id": charge["id"]})
        _settle(charge["id"], "error", str(exc), event_id)
        raise ChargeRefused(502, "payment_provider_unreachable",
                            f"לא הצלחנו להתחבר לחברת הסליקה. {NOT_ACTIVATED} אפשר לנסות שוב בעוד רגע.")

    # The money moved. Written down first, on its own, so that the
    # charge is on record even if the activation below fails.
    _, event_id = record_event(
        **audit, outcome="ok",
        provider_transaction_id=result.get("provider_transaction_id"),
        response_code=result.get("response_code"),
        invoice_number=result.get("invoice_number") or None,
        invoice_url=result.get("invoice_url"),
        raw={**(result.get("raw") or {}), "charge_id": charge["id"]},
    )
    _activate(charge, card["id"], event_id, result)
    return _answer(load(charge["id"]))


def _activate(charge: dict, card_id: str, event_id: str, result: dict) -> str:
    """One transaction: the plan row, and the charge marked charged and
    pointing at it. Either both are written or neither is."""
    sub_id = str(uuid.uuid4())
    conn = get_db(PAY_DB)
    try:
        cur = conn.cursor()
        cur.execute(
            f"""INSERT INTO {ORG_DB}.marketplace_subscriptions
                    (id, advertiser_entity_type, advertiser_entity_id,
                     category_code, tier_id, slot_count, duration_days, price_nis,
                     expires_at, auto_renew, status,
                     cardcom_token_ref, payment_transaction_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s,
                        DATE_ADD(NOW(), INTERVAL %s DAY), %s, 'active',
                        %s, %s)""",
            (
                sub_id, charge["entity_type"], charge["entity_id"],
                charge["category_code"], charge["tier_id"],
                charge["slot_count"], charge["duration_days"], charge["amount_nis"],
                charge["duration_days"], bool(charge["auto_renew"]),
                # Not a token: the id of the card row that paid, and the
                # id of the payment_events row of the charge.
                card_id, event_id,
            ),
        )
        cur.execute(
            f"""UPDATE {PAY_DB}.marketplace_charges
                   SET status='charged', subscription_id=%s, payment_method_id=%s,
                       payment_event_id=%s, provider_transaction_id=%s,
                       invoice_number=%s, invoice_url=%s, failure_reason=NULL
                 WHERE id=%s AND status='charging'""",
            (sub_id, card_id, event_id, result.get("provider_transaction_id") or None,
             result.get("invoice_number") or None, result.get("invoice_url"), charge["id"]),
        )
        if cur.rowcount != 1:
            raise RuntimeError(f"charge {charge['id']} was not in 'charging' at activation")
        cur.execute(f"UPDATE {PAY_DB}.payment_methods SET last_used_at=NOW() WHERE id=%s", (card_id,))
        conn.commit()
    except Exception:
        conn.rollback()
        # The card was charged and the plan was not written. The charge
        # row stays 'charging' with a payment_events row that says ok:
        # that pair is what to look for.
        logger.error("[marketplace-charges] charge %s was TAKEN and its plan was NOT activated (event %s)",
                     charge["id"], event_id)
        raise
    finally:
        conn.close()
    logger.info("[marketplace-charges] charge %s activated plan %s", charge["id"], sub_id)
    return sub_id


def mine(entity_type: str, entity_id: str, limit: int = 50) -> list[dict]:
    """The entity's own charges that reached Cardcom, newest first."""
    conn = get_db(PAY_DB)
    try:
        cur = conn.cursor()
        cur.execute(
            f"""SELECT m.id, m.kind, m.status, m.category_code, c.name_he AS category_name_he,
                       m.amount_nis, m.invoice_number, m.invoice_url, m.is_fake,
                       m.created_at, m.refunded_at
                  FROM {PAY_DB}.marketplace_charges m
                  LEFT JOIN {ORG_DB}.marketplace_categories c
                         ON c.code = m.category_code COLLATE utf8mb4_unicode_ci
                 WHERE m.entity_type=%s AND m.entity_id=%s
                   AND m.status IN ('charged', 'refunded', 'declined')
                 ORDER BY m.created_at DESC
                 LIMIT %s""",
            (entity_type, entity_id, int(limit)),
        )
        out = []
        for r in cur.fetchall():
            out.append({
                "id":               r["id"],
                "kind":             r["kind"],
                "status":           r["status"],
                "category_code":    r["category_code"],
                "category_name_he": r["category_name_he"],
                "amount_nis":       float(r["amount_nis"]),
                "invoice_number":   r["invoice_number"],
                "invoice_url":      r["invoice_url"],
                "mode":             "fake" if r["is_fake"] else "real",
                "created_at":       r["created_at"].isoformat() if r["created_at"] else None,
                "refunded_at":      r["refunded_at"].isoformat() if r["refunded_at"] else None,
            })
        return out
    finally:
        conn.close()
