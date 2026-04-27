from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from typing import Any, Optional
from app.system_settings import get_all_settings, set_setting

router = APIRouter()


class SettingUpdate(BaseModel):
    key: str
    value: Any


@router.get("")
def list_settings():
    """Return all system settings."""
    return get_all_settings()


@router.patch("")
def update_setting(
    body: SettingUpdate,
    x_user_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Update a setting — admin only."""
    if x_user_role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    try:
        set_setting(body.key, body.value, user_id=x_user_id or "admin")
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"key": body.key, "value": body.value, "updated": True}
