"""Auto-capture and retry service — runs via APScheduler cron jobs.

Pattern A (J5 pre-authorization):
  - process_expired_auths   → captures authorized transactions whose
                              grace window has expired.
  - process_failed_captures → retries transient capture failures until
                              max_charge_retries, then marks final.

Pattern B (legacy token + scheduled charge) is kept working for any
existing rows already in `pending_charge` state — see
`process_expired_grace_periods` and `process_retry_failed`.
"""
import json
import logging
from datetime import datetime, timedelta

from app.db import get_db
from app.crypto import decrypt_token
from app.services.cardcom import (
    capture_transaction, charge_token,
    CardcomApiError, CardcomDeclinedError, CardcomNetworkError,
)
from app.system_settings import get_setting
from app.enums import PaymentStatus

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Pattern A — J5 capture flow
# ─────────────────────────────────────────────────────────────────────────────

async def process_expired_auths():
    """
    Scheduled sweep — captures authorized transactions whose grace period
    has expired. Runs once per minute so 48h grace windows resolve within
    ~1 minute of the expiry.

    For each row:
      1. Run blocking checks (discrepancy, admin hold, card expired).
      2. If blocked → on_hold_admin, admin must act.
      3. Else capture via Cardcom.
      4. On success → captured.
      5. On transient failure → capture_failed (will retry via process_failed_captures).
      6. If simulate_next_capture_fails=TRUE on the row → fail synthetically
         and clear the flag (admin simulation panel knob).
    """
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT * FROM payment_transactions
               WHERE status=%s AND grace_period_expires_at < NOW()
               LIMIT 100""",
            (PaymentStatus.AUTHORIZED,)
        )
        rows = cur.fetchall()
        logger.info("[capture] %d expired-grace authorizations to capture", len(rows))
        for tx in rows:
            await _attempt_capture(conn, tx)
    except Exception as e:
        logger.error("[capture] unexpected error: %s", e)
    finally:
        conn.close()


async def process_failed_captures():
    """
    Scheduled sweep — retry rows in `capture_failed` once the retry
    interval has elapsed. Promotes to `capture_failed_final` after the
    configured max_charge_retries have been exhausted.
    """
    try:
        max_retries   = int(get_setting("max_charge_retries", 3))
        interval_min  = int(get_setting("capture_retry_interval_minutes", 60))
    except Exception:
        max_retries, interval_min = 3, 60

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM payment_transactions WHERE status=%s LIMIT 100",
            (PaymentStatus.CAPTURE_FAILED,)
        )
        rows = cur.fetchall()
        logger.info("[capture-retry] %d capture-failed rows to evaluate", len(rows))

        for tx in rows:
            attempts = tx.get("retry_count") or 0

            if attempts >= max_retries:
                cur.execute(
                    "UPDATE payment_transactions SET status=%s, updated_at=NOW() WHERE id=%s",
                    (PaymentStatus.CAPTURE_FAILED_FINAL, tx["id"])
                )
                conn.commit()
                logger.warning(
                    "[capture-retry] tx=%s deal=%s → capture_failed_final (%d attempts)",
                    tx["id"], tx["deal_id"], attempts
                )
                continue

            last = tx.get("last_capture_attempt_at")
            if last and (datetime.utcnow() - last) < timedelta(minutes=interval_min):
                continue  # wait for the interval

            await _attempt_capture(conn, tx)
    except Exception as e:
        logger.error("[capture-retry] unexpected error: %s", e)
    finally:
        conn.close()


async def _attempt_capture(conn, tx: dict):
    """Capture one J5-authorized transaction (with retry-friendly failure handling)."""
    cur = conn.cursor()

    # Admin/deal-level block check first — lets us hold on disputes, etc.
    blocking = _check_blocking(tx)
    if blocking:
        cur.execute(
            """UPDATE payment_transactions SET
               status=%s, failure_reason=%s, last_capture_attempt_at=NOW(), updated_at=NOW()
               WHERE id=%s""",
            (PaymentStatus.ON_HOLD_ADMIN, blocking, tx["id"])
        )
        conn.commit()
        logger.warning("[capture] tx=%s → on_hold_admin: %s", tx["id"], blocking)
        return

    if not tx.get("auth_provider_deal_id"):
        cur.execute(
            """UPDATE payment_transactions SET
               status=%s, last_capture_error='missing auth_provider_deal_id',
               last_capture_attempt_at=NOW() WHERE id=%s""",
            (PaymentStatus.CAPTURE_FAILED_FINAL, tx["id"])
        )
        conn.commit()
        logger.error("[capture] tx=%s has no auth_provider_deal_id → capture_failed_final", tx["id"])
        return

    # Simulation hook — forces the next capture to fail synthetically.
    if tx.get("simulate_next_capture_fails"):
        cur.execute(
            """UPDATE payment_transactions SET
               status=%s,
               last_capture_error='SIMULATED: simulate_next_capture_fails=1',
               last_capture_attempt_at=NOW(),
               retry_count=retry_count+1,
               simulate_next_capture_fails=FALSE,
               updated_at=NOW()
               WHERE id=%s""",
            (PaymentStatus.CAPTURE_FAILED, tx["id"])
        )
        conn.commit()
        logger.warning("[capture SIM] tx=%s forced to fail", tx["id"])
        return

    try:
        result = await capture_transaction(
            auth_provider_deal_id = tx["auth_provider_deal_id"],
            amount                = float(tx["total_amount"]),
            idempotency_key       = f"cap:{tx['id']}",
        )
        cur.execute(
            """UPDATE payment_transactions SET
               status=%s, charged_at=NOW(), last_capture_attempt_at=NOW(),
               provider_transaction_id=%s, provider_response_code=%s,
               provider_response_raw=%s,
               invoice_number=%s, invoice_url=%s, invoice_issued_at=NOW(),
               updated_at=NOW()
               WHERE id=%s""",
            (PaymentStatus.CAPTURED,
             result["provider_transaction_id"],
             result["response_code"],
             json.dumps(result["raw"]),
             result["invoice_number"],
             result["invoice_url"],
             tx["id"])
        )
        conn.commit()
        _sync_deal(tx["deal_id"], PaymentStatus.CAPTURED)
        logger.info("[capture] tx=%s deal=%s → captured", tx["id"], tx["deal_id"])
    except (CardcomDeclinedError, CardcomApiError, CardcomNetworkError) as e:
        cur.execute(
            """UPDATE payment_transactions SET
               status=%s, last_capture_error=%s, last_capture_attempt_at=NOW(),
               retry_count=retry_count+1, updated_at=NOW()
               WHERE id=%s""",
            (PaymentStatus.CAPTURE_FAILED, str(e), tx["id"])
        )
        conn.commit()
        logger.error("[capture] tx=%s capture failed: %s", tx["id"], e)


def _check_blocking(tx: dict) -> str:
    """Returns a reason string if the transaction is blocked from capture, else ''."""
    deal_conn = get_db("deal_db")
    try:
        cur = deal_conn.cursor()
        cur.execute(
            "SELECT discrepancy_flag, status, payment_hold_by_admin FROM deals WHERE id=%s",
            (tx["deal_id"],)
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
    return ""


def _sync_deal(deal_id: str, payment_status: str):
    """Best-effort denormalisation of tx status onto the deal row."""
    try:
        conn = get_db("deal_db")
        try:
            cur = conn.cursor()
            cur.execute(
                "UPDATE deals SET payment_status=%s WHERE id=%s",
                (payment_status, deal_id)
            )
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────────────────────
# Pattern B — legacy token + scheduled charge (kept working)
# ─────────────────────────────────────────────────────────────────────────────

async def process_expired_grace_periods():
    """
    Legacy scheduler for Pattern B (pending_charge). Still runs daily at
    02:00 so any existing pending_charge rows keep advancing until the
    team is fully migrated off Pattern B.
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
        logger.info("[auto-charge legacy] %d expired grace period transactions to process", len(rows))
        for tx in rows:
            await _process_one_legacy(conn, tx)
    except Exception as e:
        logger.error("[auto-charge legacy] unexpected error: %s", e)
    finally:
        conn.close()


async def process_retry_failed():
    """Legacy Pattern-B retry sweep (charge_failed rows)."""
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
        logger.info("[retry legacy] %d failed transactions to evaluate", len(rows))

        for tx in rows:
            retry_count = tx.get("retry_count") or 0

            if retry_count >= max_retries:
                cur.execute(
                    "UPDATE payment_transactions SET status='charge_failed_final', updated_at=NOW() WHERE id=%s",
                    (tx["id"],)
                )
                conn.commit()
                logger.warning("[retry legacy] tx=%s → charge_failed_final (max retries)", tx["id"])
                continue

            last_retry = tx.get("last_retry_at")
            required_hours = retry_delays[retry_count] if retry_count < len(retry_delays) else 72
            if last_retry:
                hours_since = (datetime.utcnow() - last_retry).total_seconds() / 3600
                if hours_since < required_hours:
                    continue

            await _attempt_charge_legacy(conn, tx, status_on_success="charged_auto")
    except Exception as e:
        logger.error("[retry legacy] unexpected error: %s", e)
    finally:
        conn.close()


async def _process_one_legacy(conn, tx: dict):
    """Legacy: process one expired grace period transaction."""
    cur = conn.cursor()
    blocking = _check_blocking(tx)
    if blocking:
        cur.execute(
            "UPDATE payment_transactions SET status='on_hold_admin', failure_reason=%s, updated_at=NOW() WHERE id=%s",
            (blocking, tx["id"])
        )
        conn.commit()
        logger.warning("[auto-charge legacy] tx=%s → on_hold_admin: %s", tx["id"], blocking)
        return

    await _attempt_charge_legacy(conn, tx, status_on_success="charged_auto")


async def _attempt_charge_legacy(conn, tx: dict, status_on_success: str):
    """Legacy Pattern-B token-based charge."""
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
            provider_token  = raw_token,
            base_amount     = float(tx["base_amount"]),
            vat_amount      = float(tx["vat_amount"]),
            deal_id         = tx["deal_id"],
            idempotency_key = tx["idempotency_key"],
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
        logger.info("[charge legacy] tx=%s deal=%s → %s", tx["id"], tx["deal_id"], status_on_success)
    except (CardcomDeclinedError, CardcomApiError, CardcomNetworkError) as e:
        cur.execute(
            "UPDATE payment_transactions SET status='charge_failed', failure_reason=%s, "
            "retry_count=retry_count+1, last_retry_at=NOW(), updated_at=NOW() WHERE id=%s",
            (str(e), tx["id"])
        )
        conn.commit()
        logger.error("[charge legacy] tx=%s failed: %s", tx["id"], e)
