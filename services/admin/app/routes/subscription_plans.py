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
            """SELECT id, entity_type, tier, max_users, max_reveals_per_month,
                      max_active_ads, can_boost, trial_days_default,
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
    max_reveals_per_month: Optional[int]  = Field(default=None, ge=0)
    max_active_ads:        Optional[int]  = Field(default=None, ge=0)
    can_boost:             Optional[bool] = None
    trial_days_default:    Optional[int]  = Field(default=None, ge=1, le=365)
    cardcom_plan_code:     Optional[str]  = None
    # Explicit "null" for unlimited must be represented via a separate
    # sentinel — Pydantic can't distinguish "omitted" from "set to None"
    # inside a Patch. Frontend sends {"unlimited": ["max_users"]} to zero
    # out a cap.
    unlimited: list[str] = Field(default_factory=list)


@router.patch("/subscription-plans/{plan_id}")
def update_plan(plan_id: str, body: PlanPatch):
    data = body.model_dump(exclude_unset=True)
    unlimited = set(data.pop("unlimited", []) or [])

    sets:   list[str]    = []
    params: list[object] = []

    for col in ("max_users", "max_reveals_per_month", "max_active_ads"):
        if col in unlimited:
            sets.append(f"{col}=NULL")
        elif col in data:
            sets.append(f"{col}=%s")
            params.append(data[col])

    for col in ("can_boost", "trial_days_default", "cardcom_plan_code"):
        if col in data:
            sets.append(f"{col}=%s")
            params.append(data[col])

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
            """SELECT id, entity_type, tier, max_users, max_reveals_per_month,
                      max_active_ads, can_boost, trial_days_default,
                      cardcom_plan_code, updated_at
                 FROM subscription_plans WHERE id=%s""",
            (plan_id,),
        )
        return _serialize(cur.fetchone())
    finally:
        conn.close()
