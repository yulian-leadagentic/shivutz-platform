from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from typing import Any, Optional
from app.system_settings import get_all_settings, set_setting
from app.services import vat
from app.services.admin_check import is_admin

router = APIRouter()


class SettingUpdate(BaseModel):
    key: str
    value: Any


@router.get("/vat")
def current_vat():
    """The VAT rate in force today, for a page that shows a price plus VAT
    before a charge (fixes list ג, item 6)."""
    try:
        return {"percent": float(vat.percent_on())}
    except vat.VatPeriodMissing:
        raise HTTPException(status_code=503, detail={"code": "vat_period_missing"})


@router.get("")
def list_settings():
    """Return all system settings."""
    return get_all_settings()


@router.patch("")
def update_setting(
    body: SettingUpdate,
    x_user_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
    x_user_is_admin: Optional[str] = Header(default=None),
):
    """Update a setting — admin only."""
    if not is_admin(x_user_is_admin, x_user_role):
        raise HTTPException(status_code=403, detail="Admin only")
    try:
        set_setting(body.key, body.value, user_id=x_user_id or "admin")
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"key": body.key, "value": body.value, "updated": True}
