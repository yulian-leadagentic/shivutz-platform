"""R37 4.1.5 · an admin returns a marketplace plan charge.

The money goes back to the card it came from, through Cardcom's
RefundByTransactionId, for the whole amount of the charge.

What is written down, every time:

  * a payment_events row of kind marketplace_refund, whatever the
    outcome: ok, declined (Cardcom refused) or error (Cardcom was not
    reached). It names the charge, the plan, the Cardcom transaction
    that was refunded and the admin who asked.
  * on success, the charge row: status refunded, when, by whom, the
    audit row's id and Cardcom's id for the refund.

What is NOT done: the plan is left exactly as it is. Whether a refunded
plan should end, and when, is not decided, so the refund moves money
and nothing else. The admin screen says so before the admin confirms.

A charge is refunded once. It is taken for refunding before Cardcom is
called, so two clicks make one refund; and Cardcom itself refuses a
second refund of a transaction unless told otherwise, which we never
tell it.
"""
import logging
from typing import Optional

from app.db import get_db
from app.services import cardcom, marketplace_charges as mc
from app.services.cardcom import CardcomApiError, CardcomNetworkError, refund_transaction
from app.services.payment_events import record_event

logger = logging.getLogger(__name__)

# What the admin list shows: every charge that reached Cardcom, and the
# ones whose outcome is not known.
ADMIN_STATUSES = ("charged", "refunded", "declined", "error", "charging", "refunding")


class RefundRefused(Exception):
    """Nothing was refunded. `status` is the HTTP status to answer
    with, `detail` a code and a Hebrew message."""
    def __init__(self, status: int, code: str, message: str, **extra):
        super().__init__(code)
        self.status = status
        self.detail = {"code": code, "message": message, **extra}


def _run(sql: str, params: tuple) -> int:
    conn = get_db(mc.PAY_DB)
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


def _claim(charge_id: str) -> bool:
    return _run(
        f"UPDATE {mc.PAY_DB}.marketplace_charges SET status='refunding' WHERE id=%s AND status='charged'",
        (charge_id,),
    ) == 1


def _release(charge_id: str) -> None:
    """The refund did not happen: the charge is a charge again."""
    _run(
        f"UPDATE {mc.PAY_DB}.marketplace_charges SET status='charged' WHERE id=%s AND status='refunding'",
        (charge_id,),
    )


def _mark_refunded(charge_id: str, admin_user_id: Optional[str], event_id: str, refund_txn: Optional[str]) -> None:
    _run(
        f"""UPDATE {mc.PAY_DB}.marketplace_charges
               SET status='refunded', refunded_at=NOW(), refunded_by_user_id=%s,
                   refund_event_id=%s, refund_transaction_id=%s
             WHERE id=%s AND status='refunding'""",
        (admin_user_id, event_id, refund_txn or None, charge_id),
    )


def _row(r: dict) -> dict:
    stamp = lambda v: v.isoformat() if v else None
    return {
        "id":               r["id"],
        "kind":             r["kind"],
        "status":           r["status"],
        "entity_type":      r["entity_type"],
        "entity_id":        r["entity_id"],
        "advertiser_name":  r.get("advertiser_name"),
        "subscription_id":  r["subscription_id"],
        "category_code":    r["category_code"],
        "category_name_he": r.get("category_name_he"),
        "amount_nis":       float(r["amount_nis"]),
        "invoice_number":   r["invoice_number"],
        "invoice_url":      r["invoice_url"],
        "failure_reason":   r["failure_reason"],
        "mode":             "fake" if r["is_fake"] else "real",
        "created_at":       stamp(r["created_at"]),
        "refunded_at":      stamp(r["refunded_at"]),
        "refunded_by_user_id": r["refunded_by_user_id"],
    }


_SELECT = """SELECT m.*, c.name_he AS category_name_he, p.name AS advertiser_name
               FROM {pay}.marketplace_charges m
               LEFT JOIN {org}.marketplace_categories c
                      ON c.code = m.category_code COLLATE utf8mb4_unicode_ci
               LEFT JOIN {org}.service_providers p
                      ON p.id = m.entity_id COLLATE utf8mb4_unicode_ci
                     AND m.entity_type = 'service_provider'"""


def list_for_admin(limit: int = 200) -> list[dict]:
    conn = get_db(mc.PAY_DB)
    try:
        cur = conn.cursor()
        marks = ",".join(["%s"] * len(ADMIN_STATUSES))
        cur.execute(
            _SELECT.format(pay=mc.PAY_DB, org=mc.ORG_DB)
            + f" WHERE m.status IN ({marks}) ORDER BY m.created_at DESC LIMIT %s",
            (*ADMIN_STATUSES, int(limit)),
        )
        return [_row(r) for r in cur.fetchall()]
    finally:
        conn.close()


def _one(charge_id: str) -> Optional[dict]:
    conn = get_db(mc.PAY_DB)
    try:
        cur = conn.cursor()
        cur.execute(_SELECT.format(pay=mc.PAY_DB, org=mc.ORG_DB) + " WHERE m.id=%s", (charge_id,))
        row = cur.fetchone()
        return _row(row) if row else None
    finally:
        conn.close()


async def refund(charge: dict, admin_user_id: Optional[str]) -> dict:
    """Refund `charge` in full. Returns the charge as it stands after.
    Raises RefundRefused when nothing was refunded."""
    if charge["status"] == "refunded":
        raise RefundRefused(409, "already_refunded", "החיוב הזה כבר זוכה.")
    if charge["status"] == "refunding":
        raise RefundRefused(409, "refund_in_progress", "זיכוי של החיוב הזה כבר מתבצע.")
    if charge["status"] != "charged":
        raise RefundRefused(409, "not_refundable", "אפשר לזכות רק חיוב שבוצע.")
    # A charge made in test mode has no transaction at Cardcom, and a
    # real one must not be "refunded" by the test answer.
    if bool(charge["is_fake"]) != cardcom.PAYMENT_FAKE_MODE:
        raise RefundRefused(409, "payment_mode_mismatch",
                            "החיוב בוצע במצב תשלום אחר מזה שהשירות פועל בו כעת. אי אפשר לזכות אותו מכאן.")
    if not _claim(charge["id"]):
        raise RefundRefused(409, "refund_in_progress", "זיכוי של החיוב הזה כבר מתבצע.")

    amount = float(charge["amount_nis"])
    audit = dict(entity_id=charge["entity_id"], entity_type=charge["entity_type"],
                 kind="marketplace_refund", amount_nis=int(round(amount)))
    about = {"charge_id": charge["id"], "subscription_id": charge.get("subscription_id"),
             "refund_of": charge.get("provider_transaction_id"), "admin_user_id": admin_user_id}

    try:
        result = await refund_transaction(charge["provider_transaction_id"])
    except CardcomNetworkError as exc:
        record_event(**audit, outcome="error", provider_transaction_id=None, raw={**about, "error": str(exc)})
        _release(charge["id"])
        raise RefundRefused(502, "payment_provider_unreachable",
                            "לא התקבלה תשובה מחברת הסליקה. לפני ניסיון נוסף כדאי לבדוק ב-Cardcom אם הזיכוי בוצע.")
    except CardcomApiError as exc:
        said = (exc.description or "").strip()
        record_event(**audit, outcome="declined", provider_transaction_id=None,
                     response_code=exc.code, raw={**about, "error": str(exc)})
        _release(charge["id"])
        raise RefundRefused(502, "refund_refused",
                            "חברת הסליקה לא אישרה את הזיכוי" + (f": {said}" if said else "") + ". החיוב לא זוכה.",
                            reason=said or None, response_code=exc.code)

    refund_txn = result.get("refund_transaction_id") or None
    _, event_id = record_event(**audit, outcome="ok", provider_transaction_id=refund_txn,
                               raw={**(result.get("raw") or {}), **about})
    _mark_refunded(charge["id"], admin_user_id, event_id, refund_txn)
    logger.info("[plan-refund] charge %s refunded by admin %s (event %s)", charge["id"], admin_user_id, event_id)
    return _one(charge["id"])
