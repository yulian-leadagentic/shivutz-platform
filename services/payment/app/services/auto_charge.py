"""Auto-charge and retry service — runs via APScheduler cron jobs."""
import logging
import json
from datetime import datetime
from app.db import get_db
from app.crypto import decrypt_token
from app.services.cardcom import (
    charge_token, CardcomApiError, CardcomDeclinedError, CardcomNetworkError
)
from app.system_settings import get_setting

logger = logging.getLogger(__name__)


async def process_expired_grace_periods():
    """
    Runs at 02:00 daily.
    Charges all pending_charge transactions whose grace period has expired.
    Checks blocking conditions before each charge.
    """
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT pt.*, pm.status AS pm_status, pm.provider_token AS raw_token
               FROM payment_transactions pt
               JOIN payment_methods pm ON pm.id = pt.payment_method_id
               WHERE pt.status = 'pending_charge'
                 AND pt.grace_period_expires_at < NOW()
               LIMIT 100"""
        )
        rows = cur.fetchall()
        logger.info("[auto-charge] %d expired grace period transactions to process", len(rows))
        for tx in rows:
            await _process_one(conn, tx)
    except Exception as e:
        logger.error("[auto-charge] unexpected error: %s", e)
    finally:
        conn.close()


async def process_retry_failed():
    """
    Runs at 03:00 daily.
    Retries charge_failed transactions per the retry_delays_hours schedule.
    """
    try:
        retry_delays = get_setting("retry_delays_hours", [24, 48, 72])
        max_retries  = int(get_setting("max_charge_retries", 3))
    except Exception:
        retry_delays = [24, 48, 72]
        max_retries  = 3

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT pt.*, pm.status AS pm_status, pm.provider_token AS raw_token
               FROM payment_transactions pt
               JOIN payment_methods pm ON pm.id = pt.payment_method_id
               WHERE pt.status = 'charge_failed'
               LIMIT 100"""
        )
        rows = cur.fetchall()
        logger.info("[retry] %d failed transactions to evaluate", len(rows))

        for tx in rows:
            retry_count = tx.get("retry_count") or 0

            # Exhausted retries
            if retry_count >= max_retries:
                cur.execute(
                    "UPDATE payment_transactions SET status='charge_failed_final', updated_at=NOW() WHERE id=%s",
                    (tx["id"],)
                )
                conn.commit()
                logger.warning("[retry] tx=%s → charge_failed_final (max retries)", tx["id"])
                continue

            # Check if enough time has passed
            last_retry = tx.get("last_retry_at")
            required_hours = retry_delays[retry_count] if retry_count < len(retry_delays) else 72
            if last_retry:
                hours_since = (datetime.utcnow() - last_retry).total_seconds() / 3600
                if hours_since < required_hours:
                    continue  # Not time yet

            await _attempt_charge(conn, tx, status_on_success="charged_auto")
    except Exception as e:
        logger.error("[retry] unexpected error: %s", e)
    finally:
        conn.close()


async def _process_one(conn, tx: dict):
    """Process one expired grace period transaction."""
    cur = conn.cursor()
    blocking = _check_blocking(tx["deal_id"], tx)
    if blocking:
        cur.execute(
            "UPDATE payment_transactions SET status='on_hold_admin', failure_reason=%s, updated_at=NOW() WHERE id=%s",
            (blocking, tx["id"])
        )
        conn.commit()
        logger.warning("[auto-charge] tx=%s → on_hold_admin: %s", tx["id"], blocking)
        return

    await _attempt_charge(conn, tx, status_on_success="charged_auto")


def _check_blocking(deal_id: str, tx: dict) -> str:
    """Returns blocking reason if blocked, else empty string."""
    deal_conn = get_db("deal_db")
    try:
        cur = deal_conn.cursor()
        cur.execute(
            "SELECT discrepancy_flag, status, payment_hold_by_admin FROM deals WHERE id=%s",
            (deal_id,)
        )
        deal = cur.fetchone()
        if not deal:
            return "עסקה לא נמצאה"
        if deal.get("discrepancy_flag"):
            return "discrepancy_flag=TRUE"
        if deal.get("status") == "disputed":
            return "deal.status=disputed"
        if deal.get("payment_hold_by_admin"):
            return "payment_hold_by_admin=TRUE"
    finally:
        deal_conn.close()

    if tx.get("pm_status") != "active":
        return f"payment_method.status={tx.get('pm_status')}"

    return ""


async def _attempt_charge(conn, tx: dict, status_on_success: str):
    """Attempt Cardcom charge for a transaction."""
    cur = conn.cursor()
    try:
        raw_token = decrypt_token(tx["raw_token"])
    except Exception as e:
        cur.execute(
            "UPDATE payment_transactions SET status='charge_failed', failure_reason=%s, "
            "retry_count=retry_count+1, last_retry_at=NOW(), updated_at=NOW() WHERE id=%s",
            (f"Token decryption failed: {e}", tx["id"])
        )
        conn.commit()
        return

    try:
        result = await charge_token(
            provider_token=raw_token,
            base_amount=float(tx["base_amount"]),
            vat_amount=float(tx["vat_amount"]),
            deal_id=tx["deal_id"],
            idempotency_key=tx["idempotency_key"],
        )
        cur.execute(
            """UPDATE payment_transactions SET
               status=%s, charged_at=NOW(),
               provider_transaction_id=%s, provider_response_code=%s,
               provider_response_raw=%s,
               invoice_number=%s, invoice_url=%s, invoice_issued_at=NOW(),
               updated_at=NOW()
               WHERE id=%s""",
            (status_on_success,
             result["provider_transaction_id"],
             result["response_code"],
             json.dumps(result["raw"]),
             result["invoice_number"],
             result["invoice_url"],
             tx["id"])
        )
        conn.commit()
        logger.info("[charge] tx=%s deal=%s → %s", tx["id"], tx["deal_id"], status_on_success)
    except (CardcomDeclinedError, CardcomApiError, CardcomNetworkError) as e:
        cur.execute(
            "UPDATE payment_transactions SET status='charge_failed', failure_reason=%s, "
            "retry_count=retry_count+1, last_retry_at=NOW(), updated_at=NOW() WHERE id=%s",
            (str(e), tx["id"])
        )
        conn.commit()
        logger.error("[charge] tx=%s failed: %s", tx["id"], e)
