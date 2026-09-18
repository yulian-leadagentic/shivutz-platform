"""Pivot/v2 admin — subscription oversight.

Reads from payment_db.subscriptions and cross-joins with org names.
Actions: extend trial, grant a paid tier for N months, revoke,
R9 convert-to-comped (free launch), R4 grant/revoke admin seats.

Numeric caps below (90d trial extend, 12mo grant limit) are business
defaults — flag before wildly increasing them.
"""
from datetime import datetime, timedelta
from typing import Optional
import json

from fastapi import APIRouter, HTTPException, Header, Query
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
    # U11 §1 · payment_db.subscriptions was declared with CHARSET=utf8mb4
    # only (055:36) → defaults to utf8mb4_0900_ai_ci on MySQL 8. org_db
    # tables are utf8mb4_unicode_ci (per 001). Joining CHAR(36) columns
    # across those two collations raises "Illegal mix of collations" and
    # returns as a generic 500 — exactly the U11 §1 symptom. Force both
    # sides to unicode_ci at the join, matching the same workaround
    # search.py:314 already uses for ads.owner_entity_id.
    #
    # R9 §4 · days_remaining is derived here (not in the FE) so a sort
    # or filter on the client works off the same number the server
    # computed, and doesn't drift when the client clock is off.
    sql = f"""
        SELECT s.*,
               COALESCE(c.company_name_he, c.company_name,
                        corp.company_name_he, corp.company_name) AS entity_name,
               CASE
                 WHEN s.status = 'trialing' AND s.trial_ends_at      IS NOT NULL
                   THEN GREATEST(0, DATEDIFF(s.trial_ends_at,      NOW()))
                 WHEN s.status = 'active'   AND s.current_period_end IS NOT NULL
                   THEN GREATEST(0, DATEDIFF(s.current_period_end, NOW()))
                 ELSE NULL
               END AS days_remaining
          FROM payment_db.subscriptions s
          LEFT JOIN org_db.contractors  c
            ON c.id    = s.entity_id COLLATE utf8mb4_unicode_ci
           AND s.entity_type = 'contractor'
          LEFT JOIN org_db.corporations corp
            ON corp.id = s.entity_id COLLATE utf8mb4_unicode_ci
           AND s.entity_type = 'corporation'
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


# ── R9 §3 · Renewal-skip summary (current calendar month) ────────────
#
# Aggregate view of "how many free-launch subs coasted through
# renewal this month, and how much revenue we forwent". Reads
# `payment_events` — the audit trail the batch writes when it hits
# `skipped_no_payment_method`. Shown as a tile on /admin/subscriptions;
# NOT emailed (an email per skip would be nine hundred emails per
# month, which is why the batch just writes an event).

@router.get("/subscriptions/skip-summary")
def skip_summary():
    """Return {count, total_amount_nis, last_at, month_start} for the
    current calendar month. Empty month → count=0, total=0.
    """
    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT COUNT(*)                     AS n,
                      COALESCE(SUM(amount_nis), 0) AS total,
                      MAX(created_at)              AS last_at
                 FROM payment_events
                WHERE kind='renewal'
                  AND outcome='skipped_no_payment_method'
                  AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')"""
        )
        row = cur.fetchone() or {}
    finally:
        conn.close()

    last_at = row.get("last_at")
    return {
        "count":            int(row.get("n") or 0),
        "total_amount_nis": int(row.get("total") or 0),
        "last_at":          last_at.isoformat() if last_at else None,
        # Month window is UTC-normalised on the server so an admin in a
        # different TZ still gets one true value per calendar month.
        "month_start":      datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat(),
    }


# ── R9 §5 · Convert a subscription to `comped` (free, admin-granted) ─
#
# Purposefully separate from `grant`. `grant` sets `status='active'`
# with a period_end and stays inside the paid lifecycle (renewal
# batch may still charge if a PM appears). `comped` says "we've
# decided this account is free until we say otherwise" — the batch
# won't touch it, and gating code treats it exactly like `active`.
# Note is mandatory; audit_log records the transition just like
# grant-seats does.

class CompIn(BaseModel):
    note: str    # human explanation — required; blank string → 422


@router.post("/subscriptions/{sub_id}/comp")
def convert_to_comped(
    sub_id: str,
    body: CompIn,
    x_user_id: Optional[str] = Header(default=None),
):
    note = (body.note or "").strip()
    if not note:
        raise HTTPException(status_code=400, detail="note_required")

    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT entity_id, entity_type, tier, status "
            "FROM subscriptions WHERE id=%s",
            (sub_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="subscription_not_found")
        old_status = row["status"]

        # Flip to comped. current_period_end is deliberately left as
        # whatever it was — comped is not gated on it (check_entitlement
        # returns True unconditionally for comped) so mutating the date
        # would only muddy the audit trail. rebill_attempts + next_attempt_at
        # are cleared so if the row is ever un-comped it starts clean.
        cur.execute(
            """UPDATE subscriptions
                 SET status='comped',
                     rebill_attempts=0,
                     next_attempt_at=NULL,
                     grace_sms_step=0,
                     cancelled_at=NULL
               WHERE id=%s""",
            (sub_id,),
        )
        conn.commit()

        audit_cur = conn.cursor()
        audit_cur.execute(
            """INSERT INTO auth_db.audit_log
                 (entity_type, entity_id, actor_id, action, metadata)
               VALUES (%s, %s, %s, %s, %s)""",
            (
                row["entity_type"], row["entity_id"],
                x_user_id or "admin",
                "sub_comped",
                json.dumps(
                    {"from_status": old_status, "to_status": "comped",
                     "tier": row["tier"], "note": note},
                    ensure_ascii=False,
                ),
            ),
        )
        conn.commit()
        return {
            "id":          sub_id,
            "status":      "comped",
            "from_status": old_status,
            "note":        note,
        }
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


# ── R4 · Grant / revoke admin-only seats ─────────────────────────────────
#
# Admin edits `extra_seats_granted` only. `extra_seats_paid` is the
# purchase column and belongs to the customer via /subscriptions/seats/…
# — a mixed edit here would let a support ticket turn a paid seat into
# a granted one and vice versa. Guarded at the SQL level (WHERE clause
# never mentions extra_seats_paid) and at the schema level (the admin
# API here has no field for it).

class GrantSeatsIn(BaseModel):
    count: int          # absolute value for extra_seats_granted (not delta)
    note:  str          # human explanation, required. blank string → 422


@router.post("/subscriptions/{sub_id}/grant-seats")
def grant_seats(
    sub_id: str,
    body: GrantSeatsIn,
    x_user_id: Optional[str] = Header(default=None),
):
    """Set the admin-granted seat count on a subscription.

    R4 §3a — count can exceed the plan's max_users; warn UI-side,
    server permits. Note is mandatory so a look-back six months later
    knows *why* (R4 §1 · seats_note).
    """
    if body.count < 0 or body.count > 100:
        raise HTTPException(status_code=400, detail="count must be 0..100")
    note = (body.note or "").strip()
    if not note:
        raise HTTPException(status_code=400, detail="note_required")

    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        # Read old value first so the audit row captures the delta.
        cur.execute(
            "SELECT entity_id, entity_type, extra_seats_granted "
            "FROM subscriptions WHERE id=%s",
            (sub_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="subscription_not_found")
        old_count = int(row["extra_seats_granted"])

        cur.execute(
            "UPDATE subscriptions "
            "SET extra_seats_granted=%s, seats_note=%s "
            "WHERE id=%s",
            (body.count, note, sub_id),
        )
        conn.commit()

        # Audit — R4 §3a requires who/when/from/to/why. Stored in the
        # same audit_log table admin org-status changes use, so the
        # existing admin log view surfaces this row too.
        import json
        audit_cur = conn.cursor()
        audit_cur.execute(
            """INSERT INTO auth_db.audit_log
                 (entity_type, entity_id, actor_id, action, metadata)
               VALUES (%s, %s, %s, %s, %s)""",
            (
                row["entity_type"], row["entity_id"],
                x_user_id or "admin",
                "seats_granted",
                json.dumps(
                    {"from": old_count, "to": body.count, "note": note},
                    ensure_ascii=False,
                ),
            ),
        )
        conn.commit()
        return {
            "id":                  sub_id,
            "extra_seats_granted": body.count,
            "previous":            old_count,
            "seats_note":          note,
        }
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
