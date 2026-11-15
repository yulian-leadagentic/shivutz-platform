"""Cardcom webhook receiver.

POST /cardcom is Cardcom's call when a card page is finished. Nothing in
its body is believed (R37 4.1.6). One value is read from it, the id of
the page, and only to find OUR pending row for that page
(payment_card_setups). Whose card it is comes from that row; whether a
card was saved comes from asking Cardcom (GetLpResult). An id we never
issued is ignored. A repeated call finds the row finished and changes
nothing. The answer is always 200 and says nothing about the outcome.

L5 §5 also adds POST /cardcom-recurring for Cardcom-driven monthly
charge notifications. That path IS signature-verified (HMAC-SHA256
of the raw body with CARDCOM_WEBHOOK_SECRET), and idempotent by
provider_transaction_id via payment_events UNIQUE.
"""
import hashlib
import hmac
import json
import logging
import os
from datetime import datetime, timedelta
from urllib.parse import parse_qs

from fastapi import APIRouter, Header, HTTPException, Request

from app.db import get_db
from app.services import card_setup
from app.services.payment_events import record_event

logger = logging.getLogger(__name__)
router = APIRouter()


_PAGE_ID_KEYS = ("LowProfileId", "lowprofileid", "lowprofilecode", "LowProfileCode")


async def _page_id(request: Request) -> str | None:
    """The card page's id, wherever Cardcom put it: the query string, a
    JSON body or a form body."""
    for key in _PAGE_ID_KEYS:
        if request.query_params.get(key):
            return request.query_params[key].strip()
    raw = (await request.body()).decode("utf-8", errors="replace").strip()
    if not raw:
        return None
    fields: dict = {}
    if raw.startswith("{"):
        try:
            parsed = json.loads(raw)
            fields = parsed if isinstance(parsed, dict) else {}
        except ValueError:
            fields = {}
    else:
        fields = {k: v[0] for k, v in parse_qs(raw).items() if v}
    for key in _PAGE_ID_KEYS:
        if fields.get(key):
            return str(fields[key]).strip()
    return None


@router.post("/cardcom")
async def cardcom_webhook(request: Request):
    try:
        low_profile_id = await _page_id(request)
        if not low_profile_id:
            return {"received": True}  # test ping or empty call

        setup = card_setup.load(low_profile_id=low_profile_id[:64])
        if not setup:
            logger.warning("[webhook/cardcom] no setup of ours for this page id, ignored")
            return {"received": True}

        out = await card_setup.complete(setup)
        logger.info("[webhook/cardcom] setup=%s status=%s", setup["id"], out["status"])
    except Exception as e:  # noqa: BLE001
        logger.error("[webhook/cardcom] not completed: %s", e)

    # ALWAYS 200 to Cardcom, and the same body whatever happened.
    return {"received": True}


# ─── L5 §5 · POST /cardcom-recurring — monthly renewal notifications ─
#
# Two hard requirements, both enforced up front:
#   1. Signature. HMAC-SHA256(body, CARDCOM_WEBHOOK_SECRET) must match
#      the X-Cardcom-Signature header. Missing or wrong → 401. This
#      is the only auth on the endpoint; the gateway lets it through
#      unauthenticated because THIS check is the security boundary.
#   2. Idempotency. Cardcom retries webhooks by design; every replay
#      of the same transaction id is a no-op after the first success
#      (guaranteed by the UNIQUE(provider_transaction_id) on
#      payment_events — record_event returns inserted=False on the
#      second attempt).
#
# ReturnValue carries "sub:<entity_type>:<entity_id>" so we can find
# the subscription row without a Cardcom→sub-id mapping table.

RECURRING_RENEWAL_DAYS = 30
# 32-hex is the HMAC-SHA256 output length in bytes as hex chars.
_SIG_HEADER = "X-Cardcom-Signature"


def _verify_signature(body: bytes, header_sig: str | None) -> bool:
    """Constant-time compare of `sha256=<hex>` header against
    HMAC-SHA256 of the raw request body with CARDCOM_WEBHOOK_SECRET.
    """
    secret = os.getenv("CARDCOM_WEBHOOK_SECRET", "").strip()
    if not secret or not header_sig:
        return False
    prefix = "sha256="
    if not header_sig.startswith(prefix):
        return False
    provided = header_sig[len(prefix):]
    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(provided, expected)


@router.post("/cardcom-recurring")
async def cardcom_recurring(
    request: Request,
    x_cardcom_signature: str | None = Header(default=None, alias=_SIG_HEADER),
):
    raw_body = await request.body()

    if not _verify_signature(raw_body, x_cardcom_signature):
        # 401 without a body — do NOT explain what's missing to an
        # unauthenticated caller.
        logger.warning("[webhook/recurring] signature verification FAILED")
        raise HTTPException(status_code=401, detail="unauthorized")

    # Cardcom sends application/x-www-form-urlencoded; body already
    # buffered above so we parse it here rather than a second read.
    from urllib.parse import parse_qs
    parsed = {k: v[0] if v else "" for k, v in parse_qs(raw_body.decode("utf-8", errors="replace")).items()}

    txn_id  = (parsed.get("TranzactionId") or parsed.get("InternalDealNumber") or "").strip()
    rc      = (parsed.get("ResponseCode") or "").strip()
    ret_val = (parsed.get("ReturnValue") or "").strip()
    amount  = parsed.get("Amount") or ""
    invoice_number = (parsed.get("InvoiceNumber") or "").strip() or None
    invoice_url    = (parsed.get("InvoiceUrl") or "").strip() or None

    # ReturnValue we ourselves stamped when initiating the recurring
    # subscription at Cardcom. Format: "sub:<entity_type>:<entity_id>".
    parts = ret_val.split(":")
    if len(parts) != 3 or parts[0] != "sub":
        logger.error("[webhook/recurring] unrecognised ReturnValue=%r", ret_val)
        return {"received": True, "handled": False, "reason": "bad_return_value"}
    entity_type, entity_id = parts[1], parts[2]

    if not txn_id:
        # No txn id = nothing to dedup on = we can't safely process.
        logger.error("[webhook/recurring] no TranzactionId in payload")
        return {"received": True, "handled": False, "reason": "no_txn_id"}

    outcome = "ok" if rc in ("0", "000", "") else "declined"
    try:
        amt_int = int(round(float(amount))) if amount else None
    except ValueError:
        amt_int = None

    inserted, event_id = record_event(
        entity_id=entity_id, entity_type=entity_type,
        kind="renewal", outcome=outcome, amount_nis=amt_int,
        provider_transaction_id=txn_id,
        response_code=rc or None,
        invoice_number=invoice_number,
        invoice_url=invoice_url,
        raw=parsed,
    )
    if not inserted:
        # Cardcom is retrying an event we already processed. Idempotent
        # no-op — return 200 so it stops retrying.
        logger.info(
            "[webhook/recurring] dedup on txn=%s entity=%s/%s (event=%s)",
            txn_id, entity_type, entity_id, event_id,
        )
        return {"received": True, "handled": True, "dedup": True}

    if outcome != "ok":
        # Cardcom is telling us a scheduled charge failed. Advance the
        # failure chain with the same rules the batch uses — reusing
        # subscriptions.py's helper keeps the two paths honest about
        # what past_due / expired mean.
        from app.routes.subscriptions import _apply_failure
        conn = get_db("payment_db")
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT id, entity_id, entity_type, rebill_attempts FROM subscriptions "
                "WHERE entity_id=%s AND entity_type=%s LIMIT 1",
                (entity_id, entity_type),
            )
            sub = cur.fetchone()
        finally:
            conn.close()
        if sub:
            _apply_failure(sub, reason="cardcom_recurring_declined")
        return {"received": True, "handled": True, "outcome": "declined"}

    # Success — extend the period exactly once (dedup above ensures
    # this branch runs once per Cardcom txn id).
    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        cur.execute(
            """UPDATE subscriptions
                 SET status='active',
                     current_period_end=DATE_ADD(NOW(), INTERVAL %s DAY),
                     rebill_attempts=0,
                     next_attempt_at=NULL,
                     grace_sms_step=0
               WHERE entity_id=%s AND entity_type=%s""",
            (RECURRING_RENEWAL_DAYS, entity_id, entity_type),
        )
        conn.commit()
    finally:
        conn.close()

    return {"received": True, "handled": True, "extended_days": RECURRING_RENEWAL_DAYS}
