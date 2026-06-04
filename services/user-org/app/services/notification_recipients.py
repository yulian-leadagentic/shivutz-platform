"""Shared logic for notification-recipient management.

The same five-recipient cap, the same role gate, the same channel
defaults apply to both corporations and contractors. The route layer
just plumbs the entity_type through and delegates here.
"""
from typing import Optional
from fastapi import HTTPException
from pydantic import BaseModel, Field
import json
import uuid

from app.db import get_db


# Allowed channel codes. Anything outside this set is rejected at upsert.
# 'whatsapp' is accepted now so users can opt in before Vonage's WA
# channel is provisioned; the notification dispatcher checks per-channel
# provider availability before sending, so opt-ins are durable through
# the WhatsApp rollout (P2).
ALLOWED_CHANNELS = {"email", "sms", "whatsapp"}

# Per-product decision: max 5 active recipients per (entity_type, entity_id).
MAX_RECIPIENTS = 5


class RecipientUpsert(BaseModel):
    is_active: bool = Field(..., description="Toggle recipient on/off without losing channel prefs")
    channels:  list[str] = Field(..., description="Subset of email/sms/whatsapp")


def _validate_channels(channels: list[str]) -> list[str]:
    """Reject unknown channels; dedupe; sort for canonical storage."""
    bad = [c for c in channels if c not in ALLOWED_CHANNELS]
    if bad:
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_channels", "message": f"Unknown channels: {bad}"},
        )
    return sorted(set(channels))


def _ensure_caller_can_manage(
    cur,
    entity_type: str,
    entity_id: str,
    caller_user_id: Optional[str],
    caller_role: Optional[str],
    target_user_id: str,
):
    """Platform admins always allowed. Otherwise the caller must be either:
       (a) an admin/owner member of this entity (manages anyone), or
       (b) the target user themselves (self opt-out)."""
    if caller_role == "admin":
        return
    if not caller_user_id:
        raise HTTPException(status_code=401, detail="auth_required")

    if caller_user_id == target_user_id:
        # Self opt-out / self opt-in is always allowed.
        return

    cur.execute(
        """SELECT role FROM auth_db.entity_memberships
           WHERE entity_type = %s AND entity_id = %s
             AND user_id = %s AND is_active = TRUE
           LIMIT 1""",
        (entity_type, entity_id, caller_user_id),
    )
    row = cur.fetchone()
    if not row or row.get("role") not in ("owner", "admin"):
        raise HTTPException(
            status_code=403,
            detail={
                "code": "forbidden_recipient_manage",
                "message": "רק מנהל התאגיד יכול לסמן משתמשים אחרים כמקבלי התראות.",
            },
        )


def list_recipients(entity_type: str, entity_id: str) -> list[dict]:
    """Return one row per team member with their recipient state joined in.

    Non-recipient members come back with is_active=False and channels=[]
    so the UI can show every team member alongside their toggle state in
    a single fetch.
    """
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT em.user_id,
                      em.role           AS membership_role,
                      em.job_title,
                      u.full_name,
                      u.phone,
                      u.email,
                      nr.id             AS recipient_id,
                      nr.channels       AS channels_json,
                      COALESCE(nr.is_active, 0) AS is_recipient,
                      nr.updated_at
                 FROM auth_db.entity_memberships em
                 LEFT JOIN auth_db.users u
                        ON u.id = em.user_id
                 LEFT JOIN auth_db.notification_recipients nr
                        ON nr.entity_type = em.entity_type
                       AND nr.entity_id   = em.entity_id
                       AND nr.user_id     = em.user_id
                WHERE em.entity_type = %s
                  AND em.entity_id   = %s
                  AND em.is_active   = TRUE
                  AND em.user_id IS NOT NULL
                ORDER BY em.created_at""",
            (entity_type, entity_id),
        )
        rows = cur.fetchall()
        out = []
        for r in rows:
            channels: list[str] = []
            if r.get("channels_json"):
                try:
                    raw = r["channels_json"]
                    channels = json.loads(raw) if isinstance(raw, str) else list(raw)
                except (ValueError, TypeError):
                    channels = []
            for col in ("updated_at",):
                if hasattr(r.get(col), "isoformat"):
                    r[col] = r[col].isoformat()
            out.append({
                "user_id":         r["user_id"],
                "full_name":       r.get("full_name") or "—",
                "phone":           r.get("phone"),
                "email":           r.get("email"),
                "membership_role": r.get("membership_role"),
                "is_recipient":    bool(r.get("is_recipient")),
                "channels":        channels,
                "updated_at":      r.get("updated_at"),
            })
        return out
    finally:
        conn.close()


def upsert_recipient(
    entity_type: str,
    entity_id: str,
    target_user_id: str,
    body: RecipientUpsert,
    caller_user_id: Optional[str],
    caller_role: Optional[str],
) -> dict:
    channels = _validate_channels(body.channels)

    conn = get_db()
    try:
        cur = conn.cursor()

        # Caller must be allowed to manage this row.
        _ensure_caller_can_manage(
            cur, entity_type, entity_id,
            caller_user_id, caller_role, target_user_id,
        )

        # Target user must be an active member of the entity.
        cur.execute(
            """SELECT 1 FROM auth_db.entity_memberships
               WHERE entity_type = %s AND entity_id = %s
                 AND user_id = %s AND is_active = TRUE
               LIMIT 1""",
            (entity_type, entity_id, target_user_id),
        )
        if not cur.fetchone():
            raise HTTPException(
                status_code=404,
                detail={
                    "code": "not_a_member",
                    "message": "המשתמש אינו חבר פעיל בתאגיד.",
                },
            )

        # Pre-check the 5-recipient cap BEFORE writing — only when we're
        # turning a row ON for the first time, or turning a paused row
        # back on. Adding more channels to an already-active recipient
        # is always fine.
        if body.is_active:
            cur.execute(
                """SELECT COUNT(*) AS cnt FROM auth_db.notification_recipients
                   WHERE entity_type = %s AND entity_id = %s
                     AND is_active = TRUE AND user_id <> %s""",
                (entity_type, entity_id, target_user_id),
            )
            others_active = int(cur.fetchone()["cnt"])
            if others_active >= MAX_RECIPIENTS:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code":    "recipient_cap_reached",
                        "message": f"מותר עד {MAX_RECIPIENTS} משתמשים מקבלי התראות. בטל סימון של משתמש קיים לפני הוספה.",
                        "max":     MAX_RECIPIENTS,
                    },
                )

        # Upsert. is_active flag can be flipped; channels list can be
        # rewritten any time.
        cur.execute(
            """INSERT INTO auth_db.notification_recipients
                 (id, entity_type, entity_id, user_id, channels, is_active)
               VALUES (%s, %s, %s, %s, %s, %s)
               ON DUPLICATE KEY UPDATE
                 channels  = VALUES(channels),
                 is_active = VALUES(is_active)""",
            (
                str(uuid.uuid4()), entity_type, entity_id, target_user_id,
                json.dumps(channels), 1 if body.is_active else 0,
            ),
        )
        conn.commit()

        return {
            "user_id":   target_user_id,
            "is_active": body.is_active,
            "channels":  channels,
        }
    finally:
        conn.close()
