"""L5 §5/§6 · payment_events dedup helpers.

payment_events is the idempotency backbone: one row per Cardcom
transaction attempt, keyed uniquely on the Cardcom transaction id.
Both the recurring webhook and the renewal batch write through here
so a Cardcom retry or a duplicate batch run silently no-ops instead
of double-charging.

Never call this with a real token — cardcom.charge_token already
redacts before it returns, so `raw` carries the safe response dict.
"""
import json
import uuid
import logging
from typing import Optional

from app.db import get_db

logger = logging.getLogger(__name__)


def record_event(
    *,
    entity_id: str,
    entity_type: str,
    kind: str,
    outcome: str,
    amount_nis: Optional[int],
    provider_transaction_id: Optional[str],
    response_code: Optional[str] = None,
    invoice_number: Optional[str] = None,
    invoice_url: Optional[str] = None,
    raw: Optional[dict] = None,
) -> tuple[bool, str]:
    """Insert a payment_events row idempotently.

    Returns (inserted, event_id). inserted=False means the
    provider_transaction_id was already seen — the caller MUST NOT
    charge again or extend the subscription again. event_id is the
    id of the ORIGINAL row on a dedup hit.
    """
    event_id = str(uuid.uuid4())
    raw_json = json.dumps(raw or {}, ensure_ascii=False, default=str)[:65535]
    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        try:
            cur.execute(
                """INSERT INTO payment_events
                     (id, entity_id, entity_type, kind, outcome, amount_nis,
                      provider_transaction_id, response_code,
                      invoice_number, invoice_url, raw)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (event_id, entity_id, entity_type, kind, outcome, amount_nis,
                 provider_transaction_id, response_code,
                 invoice_number, invoice_url, raw_json),
            )
            conn.commit()
            return True, event_id
        except Exception as exc:  # noqa: BLE001
            # MySQL duplicate-key on the UNIQUE(provider_transaction_id).
            # We don't type-narrow to DuplicateEntry here because the
            # driver + connector pair varies across services; any insert
            # error with the txn id already in the table looks the same
            # from our side and MUST be treated as "already recorded".
            conn.rollback()
            if provider_transaction_id:
                cur.execute(
                    "SELECT id FROM payment_events WHERE provider_transaction_id=%s LIMIT 1",
                    (provider_transaction_id,),
                )
                existing = cur.fetchone()
                if existing:
                    logger.info(
                        "[payment_events] dedup hit for txn=%s (existing id=%s)",
                        provider_transaction_id, existing["id"],
                    )
                    return False, existing["id"]
            # Not a dedup — real error worth surfacing.
            logger.error("[payment_events] insert failed: %s", exc)
            raise
    finally:
        conn.close()
