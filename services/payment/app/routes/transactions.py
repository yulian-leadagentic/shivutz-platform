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
    charge_token, create_low_profile,
    authorize_low_profile, void_transaction, get_low_profile_result,
    fake_auth_expiry, PAYMENT_FAKE_MODE,
    CardcomApiError, CardcomDeclinedError, CardcomNetworkError,
)
from app.routes.payment_methods import get_active_payment_method
from app.enums import PaymentStatus, ACTIVE_STATUSES

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


# ── GET /deals/:dealId/preview-commission ────────────────────────────────
# Cheap no-side-effects endpoint so the frontend can show the amount inside
# the "confirm commit" modal before the user actually commits.

@router.get("/deals/{deal_id}/preview-commission")
def preview_commission(
    deal_id: str,
    x_entity_id:  Optional[str] = Header(default=None),
    x_org_id:     Optional[str] = Header(default=None),
    x_user_role:  Optional[str] = Header(default=None),
):
    try:
        result = calc_commission(deal_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {
        "deal_id": deal_id,
        "amounts": result.to_dict(),
    }


# ── POST /deals/:dealId/commit-engagement ─────────────────────────────────
# Pattern A (J5 pre-authorization):
#   1. Calculate commission for the deal.
#   2. Create a transaction row in status=pending_auth.
#   3. Ask Cardcom to host a J5 (pre-auth) form for the total amount.
#   4. Return the Cardcom URL — the frontend redirects the user there.
#   5. After the user completes the form and Cardcom redirects back, the
#      frontend calls POST /deals/{id}/complete-auth which flips the row
#      to status=authorized and starts the grace-period countdown.
#
# In PAYMENT_FAKE_MODE the whole flow short-circuits: the transaction is
# created directly in status=authorized with a FAKE- deal id, and the
# returned URL is a marker the frontend can use to simulate the redirect.

def _grace_window() -> timedelta:
    """Read grace period from settings. Prefers new `grace_period_hours`;
    falls back to the legacy `grace_period_days` for backward compat."""
    try:
        hours = int(get_setting("grace_period_hours"))
        return timedelta(hours=hours)
    except (KeyError, Exception):
        try:
            days = int(get_setting("grace_period_days", 7))
        except Exception:
            days = 7
        return timedelta(days=days)


@router.post("/deals/{deal_id}/commit-engagement", status_code=201)
async def commit_engagement(
    deal_id: str,
    x_entity_id:   Optional[str] = Header(default=None),
    x_org_id:      Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
    x_user_id:     Optional[str] = Header(default=None),
):
    """Corporation commits to a deal — initiates a J5 pre-authorization."""
    entity_id   = x_entity_id or x_org_id
    entity_type = x_entity_type or "corporation"

    if not entity_id:
        raise HTTPException(status_code=400, detail="Entity context required")

    pay_conn = get_db()
    try:
        cur = pay_conn.cursor()

        # 1. Guard: no duplicate active transaction for this deal.
        active_csv = ",".join(f"'{s.value}'" for s in ACTIVE_STATUSES)
        cur.execute(
            f"SELECT id, status FROM payment_transactions "
            f"WHERE deal_id=%s AND status IN ({active_csv}) LIMIT 1",
            (deal_id,)
        )
        existing = cur.fetchone()
        if existing:
            raise HTTPException(
                status_code=409,
                detail=f"כבר קיימת עסקת תשלום פעילה לעסקה זו (status={existing['status']})"
            )

        # 2. Commission snapshot at commit time.
        try:
            result = calc_commission(deal_id)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

        # 3. Schedule the grace window.
        grace_expires_at = datetime.utcnow() + _grace_window()

        # 4. Create the transaction row.
        tx_id           = str(uuid.uuid4())
        idempotency_key = f"auth:{tx_id}"
        initial_status  = PaymentStatus.AUTHORIZED if PAYMENT_FAKE_MODE else PaymentStatus.PENDING_AUTH

        if PAYMENT_FAKE_MODE:
            cur.execute(
                """INSERT INTO payment_transactions
                   (id, deal_id, charged_entity_type, charged_entity_id,
                    base_amount, vat_rate, vat_amount, total_amount, currency,
                    status, grace_period_expires_at, idempotency_key,
                    auth_provider_deal_id, authorized_at, auth_expires_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'ILS',%s,%s,%s,%s,NOW(),%s)""",
                (tx_id, deal_id, entity_type, entity_id,
                 result.base_amount, result.vat_rate, result.vat_amount, result.total_amount,
                 initial_status, grace_expires_at, idempotency_key,
                 f"FAKE-{tx_id[:12].upper()}", fake_auth_expiry())
            )
        else:
            cur.execute(
                """INSERT INTO payment_transactions
                   (id, deal_id, charged_entity_type, charged_entity_id,
                    base_amount, vat_rate, vat_amount, total_amount, currency,
                    status, grace_period_expires_at, idempotency_key)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'ILS',%s,%s,%s)""",
                (tx_id, deal_id, entity_type, entity_id,
                 result.base_amount, result.vat_rate, result.vat_amount, result.total_amount,
                 initial_status, grace_expires_at, idempotency_key)
            )

        # 5. Sync the deal's denormalised payment state.
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
                (datetime.utcnow(), x_user_id, initial_status,
                 tx_id, result.total_amount, deal_id)
            )
            deal_conn.commit()
        finally:
            deal_conn.close()

        pay_conn.commit()

        # 6. In fake mode we're done — no Cardcom redirect needed.
        if PAYMENT_FAKE_MODE:
            return {
                "transaction_id":          tx_id,
                "status":                  initial_status,
                "grace_period_expires_at": grace_expires_at.isoformat(),
                "amounts":                 result.to_dict(),
                "fake_mode":               True,
                "low_profile_id":          f"FAKE-{tx_id[:12].upper()}",
                "redirect_url":            None,   # frontend skips redirect
            }

        # 7. Real mode — request a J5 LowProfile from Cardcom.
        frontend_url    = os.environ.get("FRONTEND_URL", "")
        payment_svc_url = os.environ.get("PAYMENT_SERVICE_URL", "")
        return_url      = f"{frontend_url}/corporation/deals/{deal_id}?payment_result=complete&tx_id={tx_id}"

        try:
            cc = await authorize_low_profile(
                entity_id   = f"{entity_type}:{entity_id}",
                deal_id     = deal_id,
                amount      = float(result.total_amount),
                return_url  = return_url,
                webhook_url = f"{payment_svc_url}/webhooks/cardcom",
            )
        except (CardcomApiError, CardcomNetworkError) as e:
            # Roll the transaction row back to a failed state so the corp
            # can retry. We don't delete — audit log.
            cur.execute(
                "UPDATE payment_transactions SET status=%s, failure_reason=%s WHERE id=%s",
                (PaymentStatus.AUTH_FAILED, str(e), tx_id)
            )
            pay_conn.commit()
            raise HTTPException(status_code=502, detail=f"Cardcom J5 error: {e}")

        return {
            "transaction_id":          tx_id,
            "status":                  initial_status,
            "grace_period_expires_at": grace_expires_at.isoformat(),
            "amounts":                 result.to_dict(),
            "fake_mode":               False,
            "low_profile_id":          cc["low_profile_id"],
            "redirect_url":            cc["url"],
        }
    except HTTPException:
        raise
    except Exception as e:
        pay_conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        pay_conn.close()


# ── POST /deals/:dealId/complete-auth ────────────────────────────────────
# Called by the frontend after Cardcom redirects the user back. Verifies
# with Cardcom (GetLpResult) that the J5 actually succeeded, captures the
# InternalDealNumber for later capture/void, and flips the row to authorized.

class CompleteAuthInput(BaseModel):
    low_profile_id: str


@router.post("/deals/{deal_id}/complete-auth")
async def complete_auth(
    deal_id: str,
    body: CompleteAuthInput,
    x_entity_id:   Optional[str] = Header(default=None),
    x_org_id:      Optional[str] = Header(default=None),
    x_user_role:   Optional[str] = Header(default=None),
):
    entity_id = x_entity_id or x_org_id
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM payment_transactions WHERE deal_id=%s AND status IN (%s,%s) "
            "ORDER BY created_at DESC LIMIT 1",
            (deal_id, PaymentStatus.PENDING_AUTH, PaymentStatus.AUTHORIZED)
        )
        tx = cur.fetchone()
        if not tx:
            raise HTTPException(status_code=404, detail="No pending/authorized transaction for this deal")
        if x_user_role != "admin" and tx["charged_entity_id"] != entity_id:
            raise HTTPException(status_code=403, detail="Forbidden")

        # Already authorized — idempotent success.
        if tx["status"] == PaymentStatus.AUTHORIZED:
            return _serialize_tx(tx)

        # Fake mode — commit_engagement already set AUTHORIZED; nothing to do.
        if PAYMENT_FAKE_MODE:
            return _serialize_tx(tx)

        # Verify with Cardcom — never trust the redirect params alone.
        try:
            cc_result = await get_low_profile_result(body.low_profile_id)
        except (CardcomApiError, CardcomNetworkError) as e:
            cur.execute(
                "UPDATE payment_transactions SET status=%s, failure_reason=%s WHERE id=%s",
                (PaymentStatus.AUTH_FAILED, str(e), tx["id"])
            )
            conn.commit()
            raise HTTPException(status_code=502, detail=f"Cardcom verify failed: {e}")

        auth_deal_id = (cc_result.get("raw") or {}).get("TranzactionInfo", {}).get("InternalDealNumber")
        if not auth_deal_id:
            # Sometimes Cardcom returns the deal number at the top level.
            auth_deal_id = (cc_result.get("raw") or {}).get("InternalDealNumber")
        if not auth_deal_id:
            cur.execute(
                "UPDATE payment_transactions SET status=%s, failure_reason='no_auth_deal_id' WHERE id=%s",
                (PaymentStatus.AUTH_FAILED, tx["id"])
            )
            conn.commit()
            raise HTTPException(status_code=502, detail="Cardcom result missing InternalDealNumber")

        # Good — flip to AUTHORIZED.
        cur.execute(
            """UPDATE payment_transactions SET
               status=%s, authorized_at=NOW(),
               auth_provider_deal_id=%s,
               auth_expires_at=%s
               WHERE id=%s""",
            (PaymentStatus.AUTHORIZED,
             str(auth_deal_id),
             datetime.utcnow() + timedelta(days=30),   # conservative default
             tx["id"])
        )
        conn.commit()
        _update_deal_payment_status(deal_id, PaymentStatus.AUTHORIZED)

        cur.execute("SELECT * FROM payment_transactions WHERE id=%s", (tx["id"],))
        return _serialize_tx(cur.fetchone())
    finally:
        conn.close()


# ── POST /deals/:dealId/cancel-engagement ────────────────────────────────
# Void the J5 hold. Allowed for the owning corp or any admin, inside the
# grace window (grace_period_expires_at > NOW()). After the window the
# scheduler captures automatically — cancellation is no longer possible.

class CancelEngagementInput(BaseModel):
    reason: Optional[str] = None


@router.post("/deals/{deal_id}/cancel-engagement")
async def cancel_engagement(
    deal_id: str,
    body: CancelEngagementInput,
    x_entity_id:   Optional[str] = Header(default=None),
    x_org_id:      Optional[str] = Header(default=None),
    x_user_id:     Optional[str] = Header(default=None),
    x_user_role:   Optional[str] = Header(default=None),
):
    entity_id = x_entity_id or x_org_id
    is_admin  = x_user_role == "admin"

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM payment_transactions WHERE deal_id=%s AND status=%s LIMIT 1",
            (deal_id, PaymentStatus.AUTHORIZED)
        )
        tx = cur.fetchone()
        if not tx:
            raise HTTPException(status_code=404, detail="No authorized transaction to cancel")

        if not is_admin and tx["charged_entity_id"] != entity_id:
            raise HTTPException(status_code=403, detail="Forbidden")

        # Grace window guard — non-admin only.
        if not is_admin and tx["grace_period_expires_at"] and tx["grace_period_expires_at"] <= datetime.utcnow():
            raise HTTPException(
                status_code=409,
                detail="חלון הביטול (grace period) הסתיים — לא ניתן לבטל, החיוב כבר מתבצע או בוצע"
            )

        # Void at Cardcom (or synthetically in fake mode).
        if tx["auth_provider_deal_id"]:
            try:
                await void_transaction(tx["auth_provider_deal_id"])
            except (CardcomApiError, CardcomNetworkError) as e:
                # Mark the tx so admin can retry the void, but don't block the user.
                cur.execute(
                    "UPDATE payment_transactions SET failure_reason=%s WHERE id=%s",
                    (f"void_failed: {e}", tx["id"])
                )
                conn.commit()
                raise HTTPException(status_code=502, detail=f"Cardcom void error: {e}")

        final_status = PaymentStatus.VOIDED_BY_ADMIN if is_admin else PaymentStatus.VOIDED_BY_CORP
        cur.execute(
            """UPDATE payment_transactions SET
               status=%s, cancelled_at=NOW(),
               cancelled_by_user_id=%s, cancellation_reason=%s
               WHERE id=%s""",
            (final_status, x_user_id, body.reason, tx["id"])
        )
        conn.commit()
        _update_deal_payment_status(deal_id, final_status)

        return {"transaction_id": tx["id"], "status": final_status}
    finally:
        conn.close()


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
