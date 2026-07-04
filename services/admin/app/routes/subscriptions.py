"""Pivot/v2 admin — subscription oversight.

Reads from payment_db.subscriptions and cross-joins with org names.
Actions: extend trial, grant a paid tier for N months, revoke.

Numeric caps below (14d trial extend, 12mo grant limit) are business
defaults — flag before wildly increasing them.
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.db import get_db

router = APIRouter()

MAX_TRIAL_EXTEND_DAYS = 90
MAX_GRANT_MONTHS      = 12
VALID_TIERS  = {"basic", "advanced", "pro"}


def _serialize(row: dict) -> dict:
    out = dict(row)
    for k, v in list(out.items()):
        if isinstance(v, datetime):
            out[k] = v.isoformat()
    return out


# ── List ──────────────────────────────────────────────────────────────────

@router.get("/subscriptions")
def list_subscriptions(
    status: Optional[str] = Query(default=None),
    tier:   Optional[str] = Query(default=None),
    entity_type: Optional[str] = Query(default=None),
    limit:  int = Query(default=200, le=1000),
):
    wheres = []
    params: list[object] = []
    if status:
        wheres.append("s.status = %s")
        params.append(status)
    if tier and tier in VALID_TIERS:
        wheres.append("s.tier = %s")
        params.append(tier)
    if entity_type in ("contractor", "corporation"):
        wheres.append("s.entity_type = %s")
        params.append(entity_type)

    # Payment DB doesn't have entity names — join via cross-schema query.
    sql = f"""
        SELECT s.*,
               COALESCE(c.company_name_he, c.company_name,
                        corp.company_name_he, corp.company_name) AS entity_name
          FROM payment_db.subscriptions s
          LEFT JOIN org_db.contractors  c    ON c.id    = s.entity_id AND s.entity_type = 'contractor'
          LEFT JOIN org_db.corporations corp ON corp.id = s.entity_id AND s.entity_type = 'corporation'
         {'WHERE ' + ' AND '.join(wheres) if wheres else ''}
         ORDER BY s.updated_at DESC
         LIMIT {limit}
    """
    conn = get_db("org_db")   # any schema works; we fully-qualify the tables above
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        return [_serialize(r) for r in cur.fetchall()]
    finally:
        conn.close()


# ── Extend trial ──────────────────────────────────────────────────────────

class ExtendTrialIn(BaseModel):
    days: int


@router.post("/subscriptions/{sub_id}/extend-trial")
def extend_trial(sub_id: str, body: ExtendTrialIn):
    if body.days < 1 or body.days > MAX_TRIAL_EXTEND_DAYS:
        raise HTTPException(status_code=400, detail=f"days must be 1..{MAX_TRIAL_EXTEND_DAYS}")
    new_end = datetime.utcnow() + timedelta(days=body.days)
    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        cur.execute(
            """UPDATE subscriptions
                 SET trial_ends_at=%s, status='trialing'
               WHERE id=%s""",
            (new_end, sub_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="subscription_not_found")
        conn.commit()
        return {"id": sub_id, "trial_ends_at": new_end.isoformat()}
    finally:
        conn.close()


# ── Grant paid tier for N months ──────────────────────────────────────────

class GrantIn(BaseModel):
    tier:   str    # 'basic' | 'advanced' | 'pro'
    months: int


@router.post("/subscriptions/{sub_id}/grant")
def grant_paid(sub_id: str, body: GrantIn):
    if body.tier not in VALID_TIERS:
        raise HTTPException(status_code=400, detail="invalid_tier")
    if body.months < 1 or body.months > MAX_GRANT_MONTHS:
        raise HTTPException(status_code=400, detail=f"months must be 1..{MAX_GRANT_MONTHS}")
    period_end = datetime.utcnow() + timedelta(days=30 * body.months)
    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        cur.execute(
            """UPDATE subscriptions
                 SET tier=%s, status='active',
                     current_period_end=%s, cancelled_at=NULL
               WHERE id=%s""",
            (body.tier, period_end, sub_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="subscription_not_found")
        conn.commit()
        return {"id": sub_id, "tier": body.tier, "current_period_end": period_end.isoformat()}
    finally:
        conn.close()


# ── Revoke (mark expired now) ─────────────────────────────────────────────

@router.post("/subscriptions/{sub_id}/revoke", status_code=204)
def revoke(sub_id: str):
    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE subscriptions SET status='expired', current_period_end=NOW() WHERE id=%s",
            (sub_id,),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="subscription_not_found")
        conn.commit()
    finally:
        conn.close()
