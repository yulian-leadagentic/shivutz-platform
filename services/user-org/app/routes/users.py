from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.db import get_db
from app.services import whatsapp_entity
from app.services.admin_check import is_admin

router = APIRouter()


class WhatsAppEntityIn(BaseModel):
    membership_id: Optional[str] = None


@router.get("/organizations/{org_id}/users")
def list_org_users(org_id: str):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM org_users WHERE org_id = %s AND deleted_at IS NULL",
            (org_id,)
        )
        return cur.fetchall()
    finally:
        conn.close()


# R38 · the entity this user's phone speaks for on WhatsApp. The /me
# routes are declared ahead of /{user_id} so "me" is never read as an id.

def _require_user(x_user_id: Optional[str]) -> str:
    if not x_user_id:
        raise HTTPException(status_code=401, detail="auth_required")
    return x_user_id


def _require_existing_user(cur, user_id: str) -> None:
    cur.execute(
        "SELECT id FROM auth_db.users WHERE id = %s AND deleted_at IS NULL LIMIT 1",
        (user_id,),
    )
    if not cur.fetchone():
        raise HTTPException(status_code=404, detail="user_not_found")


@router.get("/me/whatsapp-entity")
def get_my_whatsapp_entity(x_user_id: Optional[str] = Header(default=None)):
    user_id = _require_user(x_user_id)
    conn = get_db()
    try:
        return whatsapp_entity.describe(conn.cursor(), user_id)
    finally:
        conn.close()


@router.put("/me/whatsapp-entity")
def set_my_whatsapp_entity(
    body: WhatsAppEntityIn,
    x_user_id: Optional[str] = Header(default=None),
):
    user_id = _require_user(x_user_id)
    conn = get_db()
    try:
        return whatsapp_entity.set_default(conn, user_id, body.membership_id)
    finally:
        conn.close()


@router.get("/{user_id}/whatsapp-entity")
def get_user_whatsapp_entity(
    user_id: str,
    x_user_role:     Optional[str] = Header(default=None),
    x_user_is_admin: Optional[str] = Header(default=None),
):
    if not is_admin(x_user_is_admin, x_user_role):
        raise HTTPException(status_code=403, detail="admin_only")
    conn = get_db()
    try:
        cur = conn.cursor()
        _require_existing_user(cur, user_id)
        return whatsapp_entity.describe(cur, user_id)
    finally:
        conn.close()


@router.put("/{user_id}/whatsapp-entity")
def set_user_whatsapp_entity(
    user_id: str,
    body: WhatsAppEntityIn,
    x_user_role:     Optional[str] = Header(default=None),
    x_user_is_admin: Optional[str] = Header(default=None),
):
    if not is_admin(x_user_is_admin, x_user_role):
        raise HTTPException(status_code=403, detail="admin_only")
    conn = get_db()
    try:
        _require_existing_user(conn.cursor(), user_id)
        return whatsapp_entity.set_default(conn, user_id, body.membership_id)
    finally:
        conn.close()
