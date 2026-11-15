from fastapi import APIRouter, HTTPException, Header
from typing import Optional
from app.db import get_db
from app.services import card_setup
from app.services.admin_check import is_admin
from app.services.cardcom import PAYMENT_FAKE_MODE, CardcomApiError, CardcomNetworkError

router = APIRouter()


def _serialize_pm(row: dict) -> dict:
    """Safe (non-sensitive) payment method representation."""
    return {
        "id":               row["id"],
        "entity_type":      row["entity_type"],
        "entity_id":        row["entity_id"],
        "provider":         row["provider"],
        "last_4_digits":    row["last_4_digits"],
        "card_brand":       row["card_brand"],
        "card_holder_name": row["card_holder_name"],
        "expiry_month":     row["expiry_month"],
        "expiry_year":      row["expiry_year"],
        "is_default":       bool(row["is_default"]),
        "status":           row["status"],
        "created_at":       row["created_at"].isoformat() if row.get("created_at") else None,
        "last_used_at":     row["last_used_at"].isoformat() if row.get("last_used_at") else None,
    }


@router.get("")
def list_payment_methods(
    x_org_id:       Optional[str] = Header(default=None),
    x_entity_id:    Optional[str] = Header(default=None),
    x_entity_type:  Optional[str] = Header(default=None),
    x_user_role:    Optional[str] = Header(default=None),
):
    entity_id   = x_entity_id or x_org_id
    entity_type = x_entity_type
    conn = get_db()
    try:
        cur = conn.cursor()
        if x_user_role == "admin":
            cur.execute(
                "SELECT * FROM payment_methods WHERE deleted_at IS NULL ORDER BY created_at DESC"
            )
        elif entity_id and entity_type:
            cur.execute(
                "SELECT * FROM payment_methods WHERE entity_type=%s AND entity_id=%s "
                "AND deleted_at IS NULL ORDER BY is_default DESC, created_at DESC",
                (entity_type, entity_id)
            )
        else:
            return []
        return [_serialize_pm(r) for r in cur.fetchall()]
    finally:
        conn.close()


# R37 4.1.1 · POST "" used to be here: it stored whatever token the
# request body carried, for whatever entity the body named, with no
# check that the caller was that entity. Nothing called it. A card is
# now stored in one place only, card_setup._store, after Cardcom has
# confirmed it for an entity we recorded ourselves.

def _caller_entity(
    x_entity_id: Optional[str], x_org_id: Optional[str], x_entity_type: Optional[str],
) -> tuple[str, str]:
    entity_id = x_entity_id or x_org_id
    entity_type = (x_entity_type or "").lower()
    if not entity_id or entity_type not in card_setup.ENTITY_TYPES:
        raise HTTPException(status_code=403, detail="entity_required")
    return entity_type, entity_id


_PROVIDER_UNREACHABLE = {
    "code": "payment_provider_unreachable",
    "message": "לא הצלחנו להתחבר לחברת הסליקה. נסו שוב בעוד רגע.",
}


@router.post("/setup", status_code=201)
async def start_card_setup(
    x_entity_id:   Optional[str] = Header(default=None),
    x_org_id:      Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
    x_user_id:     Optional[str] = Header(default=None),
):
    """Add or replace the caller's card. Answers where to send the
    browser: Cardcom's page, where the card is typed."""
    entity_type, entity_id = _caller_entity(x_entity_id, x_org_id, x_entity_type)
    try:
        return await card_setup.start(entity_type, entity_id, x_user_id)
    except card_setup.CardSetupUnavailable:
        raise HTTPException(status_code=503, detail={
            "code": "card_setup_unavailable",
            "message": "הוספת כרטיס אינה זמינה כרגע. פנו לתמיכה.",
        })
    except CardcomNetworkError:
        raise HTTPException(status_code=502, detail=_PROVIDER_UNREACHABLE)
    except CardcomApiError:
        raise HTTPException(status_code=502, detail={
            "code": "payment_provider_error",
            "message": "חברת הסליקה לא פתחה את עמוד הכרטיס. נסו שוב או פנו לתמיכה.",
        })


@router.post("/setup/{setup_id}/confirm")
async def confirm_card_setup(
    setup_id: str,
    x_entity_id:   Optional[str] = Header(default=None),
    x_org_id:      Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    """The return page asks: did my card get saved? Answered by asking
    Cardcom, for the caller's own setup only. Asking twice is harmless."""
    entity_type, entity_id = _caller_entity(x_entity_id, x_org_id, x_entity_type)
    setup = card_setup.load(setup_id=setup_id)
    # Someone else's setup reads the same as one that does not exist.
    if not setup or setup["entity_id"] != entity_id or setup["entity_type"] != entity_type:
        raise HTTPException(status_code=404, detail="card_setup_not_found")
    try:
        out = await card_setup.complete(setup)
    except CardcomNetworkError:
        raise HTTPException(status_code=502, detail=_PROVIDER_UNREACHABLE)

    method = None
    if out["status"] == "completed" and out.get("payment_method_id"):
        conn = get_db()
        try:
            cur = conn.cursor()
            cur.execute("SELECT * FROM payment_methods WHERE id=%s", (out["payment_method_id"],))
            row = cur.fetchone()
            method = _serialize_pm(row) if row else None
        finally:
            conn.close()
    return {
        "status": out["status"],
        "payment_method": method,
        "reason": out.get("reason"),
        "mode": "fake" if PAYMENT_FAKE_MODE else "real",
    }


@router.get("/{pm_id}")
def get_payment_method(
    pm_id: str,
    x_entity_id:  Optional[str] = Header(default=None),
    x_org_id:     Optional[str] = Header(default=None),
    x_user_role:  Optional[str] = Header(default=None),
    x_user_is_admin:  Optional[str] = Header(default=None),
):
    entity_id = x_entity_id or x_org_id
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM payment_methods WHERE id=%s AND deleted_at IS NULL", (pm_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Payment method not found")
        if not is_admin(x_user_is_admin, x_user_role) and row["entity_id"] != entity_id:
            raise HTTPException(status_code=403, detail="Forbidden")
        return _serialize_pm(row)
    finally:
        conn.close()


@router.patch("/{pm_id}/set-default")
def set_default_payment_method(
    pm_id: str,
    x_entity_id:  Optional[str] = Header(default=None),
    x_org_id:     Optional[str] = Header(default=None),
    x_user_role:  Optional[str] = Header(default=None),
    x_user_is_admin:  Optional[str] = Header(default=None),
):
    entity_id = x_entity_id or x_org_id
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM payment_methods WHERE id=%s AND deleted_at IS NULL", (pm_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Payment method not found")
        if not is_admin(x_user_is_admin, x_user_role) and row["entity_id"] != entity_id:
            raise HTTPException(status_code=403, detail="Forbidden")
        cur.execute(
            "UPDATE payment_methods SET is_default=FALSE "
            "WHERE entity_type=%s AND entity_id=%s AND deleted_at IS NULL",
            (row["entity_type"], row["entity_id"])
        )
        cur.execute("UPDATE payment_methods SET is_default=TRUE WHERE id=%s", (pm_id,))
        conn.commit()
        return {"id": pm_id, "is_default": True}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@router.delete("/{pm_id}", status_code=204)
def delete_payment_method(
    pm_id: str,
    x_entity_id:  Optional[str] = Header(default=None),
    x_org_id:     Optional[str] = Header(default=None),
    x_user_role:  Optional[str] = Header(default=None),
    x_user_is_admin:  Optional[str] = Header(default=None),
):
    entity_id = x_entity_id or x_org_id
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM payment_methods WHERE id=%s AND deleted_at IS NULL", (pm_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Payment method not found")
        if not is_admin(x_user_is_admin, x_user_role) and row["entity_id"] != entity_id:
            raise HTTPException(status_code=403, detail="Forbidden")
        cur.execute(
            "UPDATE payment_methods SET deleted_at=NOW(), status='removed' WHERE id=%s", (pm_id,)
        )
        conn.commit()
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


def get_active_payment_method(entity_type: str, entity_id: str) -> Optional[dict]:
    """
    Helper used by transaction service.
    Returns the default active payment method row (includes encrypted token).
    """
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT * FROM payment_methods
               WHERE entity_type=%s AND entity_id=%s AND status='active' AND deleted_at IS NULL
               ORDER BY is_default DESC, created_at DESC LIMIT 1""",
            (entity_type, entity_id)
        )
        return cur.fetchone()
    finally:
        conn.close()
