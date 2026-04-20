from fastapi import APIRouter, HTTPException, Header, Query
from pydantic import BaseModel
from typing import Optional
from decimal import Decimal
from datetime import datetime, timedelta
import uuid, json, os

from app.db import get_db
from app.crypto import decrypt_token
from app.system_settings import get_setting
from app.services.commission_calculator import calculate as calc_commission
from app.services.cardcom import (
    charge_token, create_low_profile, CardcomApiError, CardcomDeclinedError, CardcomNetworkError
)
from app.routes.payment_methods import get_active_payment_method
from app.enums import PaymentStatus

router = APIRouter()


def _serialize_tx(row: dict) -> dict:
    result = {}
    for k, v in row.items():
        if hasattr(v, "isoformat"):
            result[k] = v.isoformat()
        elif isinstance(v, Decimal):
            result[k] = float(v)
        else:
            result[k] = v
    return result


def _update_deal_payment_status(deal_id: str, payment_status: str):
    """Sync payment_status on the deal record (best-effort)."""
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


# ── GET /transactions ──────────────────────────────────────────────────────

@router.get("/transactions")
def list_transactions(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    x_entity_id:   Optional[str] = Header(default=None),
    x_org_id:      Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
    x_user_role:   Optional[str] = Header(default=None),
):
    """List transactions visible to the caller. Paginated envelope."""
    entity_id   = x_entity_id or x_org_id
    entity_type = x_entity_type
    offset = (page - 1) * page_size
    empty = {"items": [], "page": page, "page_size": page_size, "total": 0}

    conn = get_db()
    try:
        cur = conn.cursor()
        if x_user_role == "admin":
            where, params = "", ()
        elif entity_id and entity_type:
            where = "WHERE charged_entity_type=%s AND charged_entity_id=%s"
            params = (entity_type, entity_id)
        else:
            return empty

        cur.execute(f"SELECT COUNT(*) AS c FROM payment_transactions {where}", params)
        total = int(cur.fetchone()["c"])

        cur.execute(
            f"SELECT * FROM payment_transactions {where} "
            f"ORDER BY created_at DESC LIMIT %s OFFSET %s",
            params + (page_size, offset),
        )
        items = [_serialize_tx(r) for r in cur.fetchall()]
        return {"items": items, "page": page, "page_size": page_size, "total": total}
    finally:
        conn.close()


@router.get("/transactions/{tx_id}")
def get_transaction(
    tx_id: str,
    x_entity_id:  Optional[str] = Header(default=None),
    x_org_id:     Optional[str] = Header(default=None),
    x_user_role:  Optional[str] = Header(default=None),
):
    entity_id = x_entity_id or x_org_id
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM payment_transactions WHERE id=%s", (tx_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Transaction not found")
        if x_user_role != "admin" and row["charged_entity_id"] != entity_id:
            raise HTTPException(status_code=403, detail="Forbidden")
        return _serialize_tx(row)
    finally:
        conn.close()


# ── POST /deals/:dealId/commit-engagement ─────────────────────────────────

@router.post("/deals/{deal_id}/commit-engagement", status_code=201)
def commit_engagement(
    deal_id: str,
    x_entity_id:   Optional[str] = Header(default=None),
    x_org_id:      Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
    x_user_id:     Optional[str] = Header(default=None),
):
    """Corporation commits to a deal — creates a pending_charge transaction."""
    entity_id   = x_entity_id or x_org_id
    entity_type = x_entity_type or "corporation"

    if not entity_id:
        raise HTTPException(status_code=400, detail="Entity context required")

    # 1. Verify active payment method exists
    pm = get_active_payment_method(entity_type, entity_id)
    if not pm:
        raise HTTPException(
            status_code=402,
            detail="אין אמצעי תשלום פעיל — יש לשמור כרטיס אשראי תחילה"
        )

    pay_conn = get_db()
    try:
        cur = pay_conn.cursor()

        # 2. Guard: no duplicate active transaction for this deal
        cur.execute(
            "SELECT id FROM payment_transactions WHERE deal_id=%s "
            "AND status NOT IN ('cancelled_by_corp','cancelled_by_admin','charge_failed_final') "
            "LIMIT 1",
            (deal_id,)
        )
        if cur.fetchone():
            raise HTTPException(status_code=409, detail="כבר קיימת עסקת תשלום פעילה לעסקה זו")

        # 3. Calculate commission (snapshot at commit time)
        try:
            result = calc_commission(deal_id)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

        # 4. Grace period
        grace_days       = int(get_setting("grace_period_days", 7))
        grace_expires_at = datetime.utcnow() + timedelta(days=grace_days)

        # 5. Create transaction
        idempotency_key = f"{deal_id}:{str(uuid.uuid4())}"
        tx_id           = str(uuid.uuid4())

        cur.execute(
            """INSERT INTO payment_transactions
               (id, deal_id, charged_entity_type, charged_entity_id, payment_method_id,
                base_amount, vat_rate, vat_amount, total_amount, currency,
                status, grace_period_expires_at, idempotency_key)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'ILS',%s,%s,%s)""",
            (tx_id, deal_id, entity_type, entity_id, pm["id"],
             result.base_amount, result.vat_rate, result.vat_amount, result.total_amount,
             PaymentStatus.PENDING_CHARGE, grace_expires_at, idempotency_key)
        )

        # 6. Update deal
        deal_conn = get_db("deal_db")
        try:
            deal_cur = deal_conn.cursor()
            deal_cur.execute(
                """UPDATE deals SET
                   corp_committed_at=%s,
                   corp_committed_by_user_id=%s,
                   payment_status=%s,
                   active_payment_transaction_id=%s,
                   payment_amount_estimated=%s
                   WHERE id=%s""",
                (datetime.utcnow(), x_user_id, PaymentStatus.PENDING_CHARGE,
                 tx_id, result.total_amount, deal_id)
            )
            deal_conn.commit()
        finally:
            deal_conn.close()

        pay_conn.commit()
        return {
            "transaction_id":        tx_id,
            "status":                PaymentStatus.PENDING_CHARGE,
            "grace_period_expires_at": grace_expires_at.isoformat(),
            "amounts":               result.to_dict(),
        }
    except HTTPException:
        raise
    except Exception as e:
        pay_conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        pay_conn.close()


# ── POST /deals/:dealId/approve-charge-now ────────────────────────────────

@router.post("/deals/{deal_id}/approve-charge-now")
async def approve_charge_now(
    deal_id: str,
    x_entity_id:  Optional[str] = Header(default=None),
    x_org_id:     Optional[str] = Header(default=None),
    x_user_id:    Optional[str] = Header(default=None),
):
    """Corporation approves immediate charge within the grace period."""
    entity_id = x_entity_id or x_org_id
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM payment_transactions WHERE deal_id=%s AND status=%s "
            "ORDER BY created_at DESC LIMIT 1",
            (deal_id, PaymentStatus.PENDING_CHARGE)
        )
        tx = cur.fetchone()
        if not tx:
            raise HTTPException(status_code=404, detail="לא נמצאה עסקת תשלום ממתינה לעסקה זו")
        if tx["charged_entity_id"] != entity_id:
            raise HTTPException(status_code=403, detail="Forbidden")

        # Get payment method + decrypt token
        cur.execute("SELECT * FROM payment_methods WHERE id=%s", (tx["payment_method_id"],))
        pm = cur.fetchone()
        if not pm or pm["status"] != "active":
            raise HTTPException(status_code=402, detail="אמצעי התשלום אינו פעיל")

        raw_token = decrypt_token(pm["provider_token"])

        try:
            charge_result = await charge_token(
                provider_token=raw_token,
                base_amount=float(tx["base_amount"]),
                vat_amount=float(tx["vat_amount"]),
                deal_id=deal_id,
                idempotency_key=tx["idempotency_key"],
            )
        except CardcomDeclinedError as e:
            cur.execute(
                "UPDATE payment_transactions SET status='charge_failed', failure_reason=%s, "
                "retry_count=retry_count+1, last_retry_at=NOW(), updated_at=NOW() WHERE id=%s",
                (str(e), tx["id"])
            )
            conn.commit()
            raise HTTPException(status_code=402, detail=f"הכרטיס נדחה: {e}")
        except (CardcomApiError, CardcomNetworkError) as e:
            cur.execute(
                "UPDATE payment_transactions SET status='charge_failed', failure_reason=%s, "
                "retry_count=retry_count+1, last_retry_at=NOW(), updated_at=NOW() WHERE id=%s",
                (str(e), tx["id"])
            )
            conn.commit()
            raise HTTPException(status_code=502, detail=f"שגיאת חיוב: {e}")

        cur.execute(
            """UPDATE payment_transactions SET
               status='charged', charged_at=NOW(), approved_at=NOW(),
               approved_by_user_id=%s,
               provider_transaction_id=%s, provider_response_code=%s,
               provider_response_raw=%s,
               invoice_number=%s, invoice_url=%s, invoice_issued_at=NOW(),
               updated_at=NOW()
               WHERE id=%s""",
            (x_user_id,
             charge_result["provider_transaction_id"],
             charge_result["response_code"],
             json.dumps(charge_result["raw"]),
             charge_result["invoice_number"],
             charge_result["invoice_url"],
             tx["id"])
        )
        _update_deal_payment_status(deal_id, "charged")
        conn.commit()
        return {
            "transaction_id": tx["id"],
            "status":         "charged",
            "invoice_url":    charge_result.get("invoice_url"),
        }
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


# ── POST /deals/:dealId/cancel-engagement ─────────────────────────────────

class CancelInput(BaseModel):
    cancellation_reason: str


@router.post("/deals/{deal_id}/cancel-engagement")
def cancel_engagement(
    deal_id: str,
    body: CancelInput,
    x_entity_id:  Optional[str] = Header(default=None),
    x_org_id:     Optional[str] = Header(default=None),
    x_user_id:    Optional[str] = Header(default=None),
):
    """Corporation cancels during grace period — no charge."""
    if not body.cancellation_reason.strip():
        raise HTTPException(status_code=400, detail="יש לספק סיבת ביטול")

    entity_id = x_entity_id or x_org_id
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM payment_transactions WHERE deal_id=%s AND status=%s "
            "ORDER BY created_at DESC LIMIT 1",
            (deal_id, PaymentStatus.PENDING_CHARGE)
        )
        tx = cur.fetchone()
        if not tx:
            raise HTTPException(status_code=404, detail="לא נמצאה עסקת תשלום ממתינה לביטול")
        if tx["charged_entity_id"] != entity_id:
            raise HTTPException(status_code=403, detail="Forbidden")

        cur.execute(
            """UPDATE payment_transactions SET
               status='cancelled_by_corp', cancelled_at=NOW(),
               cancelled_by_user_id=%s, cancellation_reason=%s,
               updated_at=NOW()
               WHERE id=%s""",
            (x_user_id, body.cancellation_reason, tx["id"])
        )

        # Cancel the deal
        deal_conn = get_db("deal_db")
        try:
            deal_cur = deal_conn.cursor()
            deal_cur.execute(
                "UPDATE deals SET status='cancelled', payment_status='cancelled_by_corp' WHERE id=%s",
                (deal_id,)
            )
            deal_conn.commit()
        finally:
            deal_conn.close()

        conn.commit()
        return {"transaction_id": tx["id"], "status": "cancelled_by_corp"}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


# ── GET /deals/:dealId/payment-status ─────────────────────────────────────

@router.get("/deals/{deal_id}/payment-status")
def get_deal_payment_status(
    deal_id: str,
    x_entity_id:  Optional[str] = Header(default=None),
    x_org_id:     Optional[str] = Header(default=None),
    x_user_role:  Optional[str] = Header(default=None),
):
    """Return the active payment transaction for a deal."""
    entity_id = x_entity_id or x_org_id
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM payment_transactions WHERE deal_id=%s ORDER BY created_at DESC LIMIT 1",
            (deal_id,)
        )
        tx = cur.fetchone()
        if not tx:
            return {"deal_id": deal_id, "payment_status": None}
        if x_user_role != "admin" and tx["charged_entity_id"] != entity_id:
            raise HTTPException(status_code=403, detail="Forbidden")
        return _serialize_tx(tx)
    finally:
        conn.close()


# ── GET /cardcom-init ─────────────────────────────────────────────────────

@router.get("/cardcom-init")
async def cardcom_init(
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
    x_org_id:      Optional[str] = Header(default=None),
):
    """Initiate a Cardcom low-profile tokenization session (amount=1.0, tokenization only)."""
    entity_id   = x_entity_id or x_org_id
    entity_type = x_entity_type

    if not entity_id or not entity_type:
        raise HTTPException(status_code=400, detail="Entity context required (x-entity-id, x-entity-type)")

    frontend_url     = os.environ.get("FRONTEND_URL", "")
    payment_svc_url  = os.environ.get("PAYMENT_SERVICE_URL", "")

    try:
        result = await create_low_profile(
            entity_id   = f"{entity_type}:{entity_id}",
            return_url  = frontend_url + "/corporation/settings/billing",
            webhook_url = payment_svc_url + "/webhooks/cardcom",
            amount      = 1.0,
        )
    except (CardcomApiError, CardcomNetworkError) as e:
        raise HTTPException(status_code=502, detail=f"Cardcom error: {e}")

    return {"url": result["url"], "low_profile_id": result["low_profile_id"]}
