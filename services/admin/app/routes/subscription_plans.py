"""Pivot/v2 admin — CRUD on the subscription_plans table.

Every limit and the trial-days default is DB-configurable. Payment
service reads these values at request time so changes go live
immediately.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.db import get_db

router = APIRouter()


def _serialize(row: dict) -> dict:
    out = dict(row)
    for k, v in list(out.items()):
        if isinstance(v, datetime):
            out[k] = v.isoformat()
    return out


@router.get("/subscription-plans")
def list_plans():
    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT id, entity_type, tier, max_users, included_users,
                      extra_user_price_nis,
                      max_reveals_per_month,
                      max_active_ads, max_ad_lifetime_days, monthly_price_nis,
                      can_boost, trial_days_default,
                      cardcom_plan_code, updated_at
                 FROM subscription_plans
                ORDER BY FIELD(entity_type,'contractor','corporation'),
                         FIELD(tier,'basic','advanced','pro')"""
        )
        return [_serialize(r) for r in cur.fetchall()]
    finally:
        conn.close()


class PlanPatch(BaseModel):
    max_users:             Optional[int]  = Field(default=None, ge=1)
    # L4 — split from max_users. included = free in base price;
    # max_users = absolute cap even when extras are sold.
    included_users:        Optional[int]  = Field(default=None, ge=1)
    # L4 — ₪/mo per extra seat above `included`. Null via `unlimited`
    # means "extras not sold on this tier" (behaviour matches the
    # pre-L4 hard cap).
    extra_user_price_nis:  Optional[int]  = Field(default=None, ge=0)
    max_reveals_per_month: Optional[int]  = Field(default=None, ge=0)
    max_active_ads:        Optional[int]  = Field(default=None, ge=0)
    max_ad_lifetime_days:  Optional[int]  = Field(default=None, ge=1, le=3650)
    monthly_price_nis:     Optional[int]  = Field(default=None, ge=0)
    can_boost:             Optional[bool] = None
    trial_days_default:    Optional[int]  = Field(default=None, ge=1, le=365)
    cardcom_plan_code:     Optional[str]  = None
    # Explicit "null" for unlimited must be represented via a separate
    # sentinel — Pydantic can't distinguish "omitted" from "set to None"
    # inside a Patch. Frontend sends {"unlimited": ["max_users"]} to zero
    # out a cap; also used for "extras not sold": {"unlimited":
    # ["extra_user_price_nis"]}.
    unlimited: list[str] = Field(default_factory=list)


@router.patch("/subscription-plans/{plan_id}")
def update_plan(plan_id: str, body: PlanPatch):
    data = body.model_dump(exclude_unset=True)
    unlimited = set(data.pop("unlimited", []) or [])

    sets:   list[str]    = []
    params: list[object] = []

    # L4 — extra_user_price_nis joins the NULL-capable set (NULL means
    # "no extras sold"); included_users stays a plain value.
    for col in ("max_users", "max_reveals_per_month", "max_active_ads", "max_ad_lifetime_days", "extra_user_price_nis"):
        if col in unlimited:
            sets.append(f"{col}=NULL")
        elif col in data:
            sets.append(f"{col}=%s")
            params.append(data[col])

    for col in ("included_users", "monthly_price_nis", "can_boost", "trial_days_default", "cardcom_plan_code"):
        if col in data:
            sets.append(f"{col}=%s")
            params.append(data[col])

    # L4 §4 — validation: included_users must not exceed max_users when
    # both are set. Fetch current values for whichever field the patch
    # didn't touch, then compare.
    if "included_users" in data or "max_users" in data:
        conn0 = get_db("payment_db")
        try:
            cur0 = conn0.cursor()
            cur0.execute(
                "SELECT included_users, max_users FROM subscription_plans WHERE id=%s",
                (plan_id,),
            )
            existing = cur0.fetchone() or {}
        finally:
            conn0.close()
        new_included = data.get("included_users", existing.get("included_users"))
        new_max      = None if "max_users" in unlimited else data.get("max_users", existing.get("max_users"))
        if new_included is not None and new_max is not None and new_included > new_max:
            raise HTTPException(
                status_code=400,
                detail={"code": "included_exceeds_max",
                        "message": "included_users must be ≤ max_users"},
            )

    if not sets:
        raise HTTPException(status_code=400, detail="no_changes")

    params.append(plan_id)
    sql = f"UPDATE subscription_plans SET {', '.join(sets)} WHERE id=%s"

    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="plan_not_found")
        conn.commit()
        cur.execute(
            """SELECT id, entity_type, tier, max_users, included_users,
                      extra_user_price_nis,
                      max_reveals_per_month,
                      max_active_ads, max_ad_lifetime_days, monthly_price_nis,
                      can_boost, trial_days_default,
                      cardcom_plan_code, updated_at
                 FROM subscription_plans WHERE id=%s""",
            (plan_id,),
        )
        return _serialize(cur.fetchone())
    finally:
        conn.close()
