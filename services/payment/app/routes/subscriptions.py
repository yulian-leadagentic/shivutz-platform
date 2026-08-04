"""Pivot/v2 Phase 1 — subscription endpoints.

State machine: trialing → active → past_due → expired/cancelled.
Lazy-init: the first time an entity calls /me, we insert a trialing row
expiring 14 days from now. Avoids coupling registration in user-org with
this service.

Fake-Cardcom mode (CARDCOM_SUBS_FAKE_MODE=1): /start skips the real
Cardcom subscription flow and immediately flips status to 'active' with
a 30-day current_period_end. Used in dev + pivot-staging until Cardcom
is set up.
"""
import os
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.db import get_db

router = APIRouter()

TRIAL_DAYS = 14
FAKE_PERIOD_DAYS = 30
FAKE_MODE = os.getenv("CARDCOM_SUBS_FAKE_MODE", "1") == "1"

VALID_TIERS  = {"basic", "advanced", "pro"}
VALID_TYPES  = {"contractor", "corporation"}


def _serialize(row: dict) -> dict:
    out = dict(row)
    for k, v in list(out.items()):
        if isinstance(v, datetime):
            out[k] = v.isoformat()
    return out


def _resolve_entity(x_entity_id: Optional[str], x_entity_type: Optional[str]) -> tuple[str, str]:
    if not x_entity_id or not x_entity_type:
        raise HTTPException(status_code=400, detail="entity_id_and_type_required")
    if x_entity_type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail="invalid_entity_type")
    return x_entity_id, x_entity_type


def _fetch(cur, entity_id: str, entity_type: str) -> Optional[dict]:
    cur.execute(
        "SELECT * FROM subscriptions WHERE entity_id=%s AND entity_type=%s LIMIT 1",
        (entity_id, entity_type),
    )
    return cur.fetchone()


GRACE_DAYS = 7  # spec B3 — corp trial-end grace before hard-cap


def _insert_trial(cur, entity_id: str, entity_type: str) -> dict:
    sub_id = str(uuid.uuid4())
    trial_ends = datetime.utcnow() + timedelta(days=TRIAL_DAYS)
    grace_ends = trial_ends + timedelta(days=GRACE_DAYS)
    cur.execute(
        """INSERT INTO subscriptions
             (id, entity_id, entity_type, tier, status, trial_ends_at, grace_ends_at)
           VALUES (%s, %s, %s, 'basic', 'trialing', %s, %s)""",
        (sub_id, entity_id, entity_type, trial_ends, grace_ends),
    )
    return _fetch(cur, entity_id, entity_type)


def _in_grace(row: dict, now: datetime) -> bool:
    """True when trial ended but grace window has not — publish/edit
    blocked, existing ads still live, contact reveals still permitted
    from the corp side (they're the ad owner, not a paywalled viewer)."""
    if row.get("status") != "trialing":
        return False
    if row.get("trial_ends_at") is None:
        return False
    if row["trial_ends_at"] > now:
        return False  # trial still active
    ge = row.get("grace_ends_at")
    return ge is None or ge > now


# ─── GET /payments/subscriptions/me ──────────────────────────────────────────
# Returns the calling entity's subscription, lazy-initialising a trial
# row if none exists. Gateway forwards x-entity-id / x-entity-type from
# the JWT.

@router.get("/me")
def get_my_subscription(
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    entity_id, entity_type = _resolve_entity(x_entity_id, x_entity_type)
    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        row = _fetch(cur, entity_id, entity_type)
        if row is None:
            row = _insert_trial(cur, entity_id, entity_type)
            conn.commit()
        return _serialize(row)
    finally:
        conn.close()


# ─── POST /payments/subscriptions/start ──────────────────────────────────────
# Begin a paid subscription for a tier. In fake mode we flip the row to
# 'active' immediately. In real mode we'd open a Cardcom recurring flow
# (TODO Phase 1.5 — needs Cardcom plan IDs).

class StartBody(BaseModel):
    tier: str  # 'basic' | 'advanced' | 'pro'


@router.post("/start")
def start_subscription(
    body: StartBody,
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    entity_id, entity_type = _resolve_entity(x_entity_id, x_entity_type)
    if body.tier not in VALID_TIERS:
        raise HTTPException(status_code=400, detail="invalid_tier")

    plan_code = f"{entity_type.upper()}_{body.tier.upper()}"

    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        row = _fetch(cur, entity_id, entity_type)
        if row is None:
            _insert_trial(cur, entity_id, entity_type)
            row = _fetch(cur, entity_id, entity_type)

        if FAKE_MODE:
            period_end = datetime.utcnow() + timedelta(days=FAKE_PERIOD_DAYS)
            cur.execute(
                """UPDATE subscriptions
                     SET tier=%s, status='active', cardcom_plan_code=%s,
                         current_period_end=%s, cancelled_at=NULL,
                         grace_sms_step=0
                   WHERE entity_id=%s AND entity_type=%s""",
                (body.tier, plan_code, period_end, entity_id, entity_type),
            )
            conn.commit()

            # B3 — renewal restores paused ads for corps that were in
            # hard-cap. Runs cross-schema; missing table (dev) or empty
            # result set is a no-op. Only touches ads that were paused
            # BY the grace cron (paused_by='grace_hard_cap') to avoid
            # un-pausing ones the corp paused manually.
            if entity_type == "corporation":
                try:
                    org_conn = get_db("org_db")
                    try:
                        org_cur = org_conn.cursor()
                        org_cur.execute(
                            """UPDATE ads SET active=TRUE, paused_by=NULL
                                WHERE owner_entity_id=%s
                                  AND active=FALSE
                                  AND paused_by='grace_hard_cap'
                                  AND deleted_at IS NULL""",
                            (entity_id,),
                        )
                        org_conn.commit()
                    finally:
                        org_conn.close()
                except Exception as exc:  # noqa: BLE001 — restore is best-effort
                    print(f"[subscriptions] grace-restore skipped: {exc}")

            return {"mode": "fake", "tier": body.tier, "status": "active",
                    "current_period_end": period_end.isoformat()}

        # Real-Cardcom path — Phase 1.5. Stamp the desired tier + plan
        # code and return a payment URL the frontend opens. Cardcom's
        # recurring webhook (POST /webhooks/cardcom-recurring) flips
        # status to 'active' on first successful charge.
        raise HTTPException(status_code=501, detail="cardcom_recurring_not_wired_yet")
    finally:
        conn.close()


# ─── POST /payments/subscriptions/cancel ─────────────────────────────────────
# Mark the subscription as cancelled. Access continues until current_period_end.

@router.post("/cancel")
def cancel_subscription(
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    entity_id, entity_type = _resolve_entity(x_entity_id, x_entity_type)
    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        row = _fetch(cur, entity_id, entity_type)
        if row is None:
            raise HTTPException(status_code=404, detail="no_subscription")
        cur.execute(
            """UPDATE subscriptions
                 SET status='cancelled', cancelled_at=NOW()
               WHERE entity_id=%s AND entity_type=%s""",
            (entity_id, entity_type),
        )
        conn.commit()
        return {"status": "cancelled"}
    finally:
        conn.close()


# ─── GET /payments/subscriptions/check ───────────────────────────────────────
# Internal endpoint the gateway hits to decide whether to allow a
# paywalled request. Returns 200 + status if entitled, 402 otherwise.
# Trial expiry is computed on read so we don't need a cron flipping
# expired trials to 'expired' before the gate works.

@router.get("/check")
def check_entitlement(
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    entity_id, entity_type = _resolve_entity(x_entity_id, x_entity_type)
    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        row = _fetch(cur, entity_id, entity_type)
        if row is None:
            row = _insert_trial(cur, entity_id, entity_type)
            conn.commit()

        now      = datetime.utcnow()
        status   = row["status"]
        entitled = False
        in_grace = False

        if status == "trialing":
            trial_live = row["trial_ends_at"] is None or row["trial_ends_at"] > now
            if trial_live:
                entitled = True
            else:
                # B3 grace — trial ended but hard-cap hasn't fired yet.
                # NOT entitled for paywalled actions (publish/edit),
                # but the frontend uses the code to render the grace
                # banner instead of a plain "subscription required"
                # wall.
                in_grace = _in_grace(row, now)
        elif status in ("active", "cancelled"):
            entitled = row["current_period_end"] is None or row["current_period_end"] > now
        elif status == "past_due":
            entitled = True  # short grace, payment service flips to expired on retry exhaustion

        if not entitled:
            raise HTTPException(
                status_code=402,
                detail={"code": "grace_period" if in_grace else "subscription_required",
                        "status": status,
                        "tier": row["tier"],
                        "grace_ends_at": row["grace_ends_at"].isoformat() if in_grace and row.get("grace_ends_at") else None},
            )
        return {"entitled": True, "status": status, "tier": row["tier"]}
    finally:
        conn.close()
