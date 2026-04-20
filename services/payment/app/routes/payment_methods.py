from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from typing import Optional
import uuid
from app.db import get_db
from app.crypto import encrypt_token

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


class SaveTokenInput(BaseModel):
    """Called after Cardcom webhook confirms tokenization."""
    entity_type:      str
    entity_id:        str
    provider_token:   str       # raw token from Cardcom — encrypted before storing
    last_4_digits:    str
    card_brand:       Optional[str] = None
    card_holder_name: Optional[str] = None
    expiry_month:     int
    expiry_year:      int


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


@router.post("", status_code=201)
def save_payment_method(
    body: SaveTokenInput,
    x_user_id: Optional[str] = Header(default=None),
):
    """Store an encrypted Cardcom token. Called after webhook verification."""
    encrypted = encrypt_token(body.provider_token)
    pm_id = str(uuid.uuid4())

    conn = get_db()
    try:
        cur = conn.cursor()
        # Unset existing default for this entity
        cur.execute(
            "UPDATE payment_methods SET is_default=FALSE "
            "WHERE entity_type=%s AND entity_id=%s AND deleted_at IS NULL",
            (body.entity_type, body.entity_id)
        )
        cur.execute(
            """INSERT INTO payment_methods
               (id, entity_type, entity_id, provider, provider_token,
                last_4_digits, card_brand, card_holder_name,
                expiry_month, expiry_year, is_default, status)
               VALUES (%s,%s,%s,'cardcom',%s,%s,%s,%s,%s,%s,TRUE,'active')""",
            (pm_id, body.entity_type, body.entity_id, encrypted,
             body.last_4_digits, body.card_brand, body.card_holder_name,
             body.expiry_month, body.expiry_year)
        )
        conn.commit()
        return {"id": pm_id, "last_4_digits": body.last_4_digits, "status": "active", "is_default": True}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@router.get("/{pm_id}")
def get_payment_method(
    pm_id: str,
    x_entity_id:  Optional[str] = Header(default=None),
    x_org_id:     Optional[str] = Header(default=None),
    x_user_role:  Optional[str] = Header(default=None),
):
    entity_id = x_entity_id or x_org_id
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM payment_methods WHERE id=%s AND deleted_at IS NULL", (pm_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Payment method not found")
        if x_user_role != "admin" and row["entity_id"] != entity_id:
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
):
    entity_id = x_entity_id or x_org_id
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM payment_methods WHERE id=%s AND deleted_at IS NULL", (pm_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Payment method not found")
        if x_user_role != "admin" and row["entity_id"] != entity_id:
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
):
    entity_id = x_entity_id or x_org_id
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM payment_methods WHERE id=%s AND deleted_at IS NULL", (pm_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Payment method not found")
        if x_user_role != "admin" and row["entity_id"] != entity_id:
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
