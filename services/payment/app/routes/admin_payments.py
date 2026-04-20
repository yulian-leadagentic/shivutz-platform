"""Admin tools for manual payment handling."""
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from typing import Optional
from decimal import Decimal
from datetime import datetime, timedelta
import json

from app.db import get_db
from app.crypto import decrypt_token
from app.system_settings import get_setting
from app.services.cardcom import (
    charge_token, refund_transaction, CardcomApiError, CardcomDeclinedError, CardcomNetworkError
)

router = APIRouter()


def _serialize(row: dict) -> dict:
    result = {}
    for k, v in row.items():
        if hasattr(v, "isoformat"):
            result[k] = v.isoformat()
        elif isinstance(v, Decimal):
            result[k] = float(v)
        else:
            result[k] = v
    return result


class AdminActionInput(BaseModel):
    admin_resolution_notes: str


# ── GET /admin/transactions ───────────────────────────────────────────────

@router.get("/transactions")
def list_admin_transactions(
    status: Optional[str] = None,
    x_user_role: Optional[str] = Header(default=None),
):
    if x_user_role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    conn = get_db()
    try:
        cur = conn.cursor()
        if status:
            cur.execute(
                "SELECT * FROM payment_transactions WHERE status=%s ORDER BY created_at DESC LIMIT 200",
                (status,)
            )
        else:
            cur.execute(
                "SELECT * FROM payment_transactions ORDER BY created_at DESC LIMIT 200"
            )
        return [_serialize(r) for r in cur.fetchall()]
    finally:
        conn.close()


@router.get("/transactions/pending-action")
def list_pending_action(
    x_user_role: Optional[str] = Header(default=None),
):
    """Transactions needing admin attention."""
    if x_user_role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM payment_transactions "
            "WHERE status IN ('charge_failed_final','on_hold_admin') "
            "ORDER BY created_at ASC"
        )
        return [_serialize(r) for r in cur.fetchall()]
    finally:
        conn.close()


@router.get("/stats")
def payment_stats(
    x_user_role: Optional[str] = Header(default=None),
):
    """Financial statistics for Admin dashboard."""
    if x_user_role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT
              COALESCE(SUM(CASE WHEN status IN ('charged','charged_auto') THEN total_amount ELSE 0 END), 0) AS total_charged,
              COALESCE(SUM(CASE WHEN status = 'pending_charge'            THEN total_amount ELSE 0 END), 0) AS total_pending,
              COALESCE(SUM(CASE WHEN status IN ('charge_failed','charge_failed_final') THEN total_amount ELSE 0 END), 0) AS total_failed,
              COALESCE(SUM(CASE WHEN status = 'refunded'                  THEN total_amount ELSE 0 END), 0) AS total_refunded,
              COUNT(CASE WHEN status IN ('charged','charged_auto')         THEN 1 END) AS count_charged,
              COUNT(CASE WHEN status = 'pending_charge'                   THEN 1 END) AS count_pending,
              COUNT(CASE WHEN status IN ('charge_failed','charge_failed_final') THEN 1 END) AS count_failed,
              COUNT(CASE WHEN status = 'on_hold_admin'                    THEN 1 END) AS count_on_hold
            FROM payment_transactions
        """)
        row = cur.fetchone() or {}
        result = {k: float(v) if isinstance(v, Decimal) else (v or 0) for k, v in row.items()}
        total = result.get("count_charged", 0) + result.get("count_failed", 0)
        result["charge_success_rate"] = round(
            result.get("count_charged", 0) / total * 100, 1
        ) if total > 0 else 0
        return result
    finally:
        conn.close()


# ── Admin actions ─────────────────────────────────────────────────────────

@router.post("/transactions/{tx_id}/retry")
async def admin_retry_charge(
    tx_id: str,
    body: AdminActionInput,
    x_user_id:   Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Manually retry a failed charge."""
    if x_user_role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    if not body.admin_resolution_notes.strip():
        raise HTTPException(status_code=400, detail="admin_resolution_notes required")

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM payment_transactions WHERE id=%s", (tx_id,))
        tx = cur.fetchone()
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction not found")
        if tx["status"] not in ("charge_failed", "charge_failed_final", "on_hold_admin"):
            raise HTTPException(status_code=400, detail=f"Cannot retry status '{tx['status']}'")

        cur.execute("SELECT * FROM payment_methods WHERE id=%s", (tx["payment_method_id"],))
        pm = cur.fetchone()
        if not pm or pm["status"] != "active":
            raise HTTPException(status_code=402, detail="Payment method is not active")

        raw_token = decrypt_token(pm["provider_token"])
        new_idem  = f"{tx['deal_id']}:admin-retry:{tx_id}"

        try:
            result = await charge_token(
                provider_token=raw_token,
                base_amount=float(tx["base_amount"]),
                vat_amount=float(tx["vat_amount"]),
                deal_id=tx["deal_id"],
                idempotency_key=new_idem,
            )
        except (CardcomApiError, CardcomDeclinedError, CardcomNetworkError) as e:
            cur.execute(
                "UPDATE payment_transactions SET status='charge_failed_final', failure_reason=%s, "
                "admin_handled_at=NOW(), admin_handled_by_user_id=%s, admin_resolution_notes=%s, "
                "retry_count=retry_count+1, last_retry_at=NOW(), updated_at=NOW() WHERE id=%s",
                (str(e), x_user_id, body.admin_resolution_notes, tx_id)
            )
            conn.commit()
            raise HTTPException(status_code=402, detail=f"Retry failed: {e}")

        cur.execute(
            """UPDATE payment_transactions SET
               status='charged', charged_at=NOW(),
               provider_transaction_id=%s, provider_response_code=%s,
               invoice_number=%s, invoice_url=%s, invoice_issued_at=NOW(),
               admin_handled_at=NOW(), admin_handled_by_user_id=%s,
               admin_resolution_notes=%s, updated_at=NOW()
               WHERE id=%s""",
            (result["provider_transaction_id"], result["response_code"],
             result["invoice_number"], result["invoice_url"],
             x_user_id, body.admin_resolution_notes, tx_id)
        )
        conn.commit()
        return {"transaction_id": tx_id, "status": "charged"}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@router.post("/transactions/{tx_id}/mark-paid-external")
def mark_paid_external(
    tx_id: str,
    body: AdminActionInput,
    x_user_id:   Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Admin marks as paid outside the system (cash/wire transfer)."""
    if x_user_role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    if not body.admin_resolution_notes.strip():
        raise HTTPException(status_code=400, detail="admin_resolution_notes required")
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT status FROM payment_transactions WHERE id=%s", (tx_id,))
        tx = cur.fetchone()
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction not found")
        cur.execute(
            """UPDATE payment_transactions SET
               status='charged', charged_at=NOW(),
               provider_transaction_id='EXTERNAL',
               admin_handled_at=NOW(), admin_handled_by_user_id=%s,
               admin_resolution_notes=%s, updated_at=NOW()
               WHERE id=%s""",
            (x_user_id, body.admin_resolution_notes, tx_id)
        )
        conn.commit()
        return {"transaction_id": tx_id, "status": "charged", "note": "marked as paid externally"}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@router.post("/transactions/{tx_id}/release-hold")
def release_hold(
    tx_id: str,
    body: AdminActionInput,
    x_user_id:   Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Release an on_hold_admin transaction back to pending_charge with a fresh grace period."""
    if x_user_role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM payment_transactions WHERE id=%s", (tx_id,))
        tx = cur.fetchone()
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction not found")
        if tx["status"] != "on_hold_admin":
            raise HTTPException(status_code=400, detail="Only on_hold_admin transactions can be released")
        grace_days = int(get_setting("grace_period_days", 7))
        new_grace  = datetime.utcnow() + timedelta(days=grace_days)
        cur.execute(
            """UPDATE payment_transactions SET
               status='pending_charge', grace_period_expires_at=%s,
               admin_handled_at=NOW(), admin_handled_by_user_id=%s,
               admin_resolution_notes=%s, updated_at=NOW()
               WHERE id=%s""",
            (new_grace, x_user_id, body.admin_resolution_notes, tx_id)
        )
        conn.commit()
        return {
            "transaction_id":        tx_id,
            "status":                "pending_charge",
            "grace_period_expires_at": new_grace.isoformat(),
        }
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@router.post("/transactions/{tx_id}/cancel")
def admin_cancel(
    tx_id: str,
    body: AdminActionInput,
    x_user_id:   Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    if x_user_role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM payment_transactions WHERE id=%s", (tx_id,))
        tx = cur.fetchone()
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction not found")
        cur.execute(
            """UPDATE payment_transactions SET
               status='cancelled_by_admin', cancelled_at=NOW(),
               cancelled_by_user_id=%s, cancellation_reason=%s,
               admin_handled_at=NOW(), admin_handled_by_user_id=%s,
               admin_resolution_notes=%s, updated_at=NOW()
               WHERE id=%s""",
            (x_user_id, body.admin_resolution_notes,
             x_user_id, body.admin_resolution_notes, tx_id)
        )
        conn.commit()
        return {"transaction_id": tx_id, "status": "cancelled_by_admin"}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@router.post("/transactions/{tx_id}/refund")
async def admin_refund(
    tx_id: str,
    body: AdminActionInput,
    x_user_id:   Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    if x_user_role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM payment_transactions WHERE id=%s", (tx_id,))
        tx = cur.fetchone()
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction not found")
        if tx["status"] not in ("charged", "charged_auto"):
            raise HTTPException(status_code=400, detail="Can only refund charged transactions")
        if not tx.get("provider_transaction_id") or tx["provider_transaction_id"] == "EXTERNAL":
            raise HTTPException(status_code=400, detail="No Cardcom transaction ID to refund")

        try:
            await refund_transaction(tx["provider_transaction_id"])
        except (CardcomApiError, CardcomNetworkError) as e:
            raise HTTPException(status_code=502, detail=f"Refund failed: {e}")

        cur.execute(
            """UPDATE payment_transactions SET
               status='refunded',
               admin_handled_at=NOW(), admin_handled_by_user_id=%s,
               admin_resolution_notes=%s, updated_at=NOW()
               WHERE id=%s""",
            (x_user_id, body.admin_resolution_notes, tx_id)
        )
        conn.commit()
        return {"transaction_id": tx_id, "status": "refunded"}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


# ── Admin: commission management ──────────────────────────────────────────

class CommissionInput(BaseModel):
    corporation_id: str
    commission_per_worker_amount: float


@router.patch("/commissions/corporation")
def set_corporation_commission(
    body: CommissionInput,
    x_user_id:   Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Admin sets commission_per_worker_amount for a corporation."""
    if x_user_role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        cur.execute(
            """UPDATE corporations SET
               commission_per_worker_amount=%s,
               commission_set_by_user_id=%s,
               commission_set_at=NOW()
               WHERE id=%s AND deleted_at IS NULL""",
            (body.commission_per_worker_amount, x_user_id, body.corporation_id)
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Corporation not found")
        conn.commit()
        return {
            "corporation_id":             body.corporation_id,
            "commission_per_worker_amount": body.commission_per_worker_amount,
        }
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()
