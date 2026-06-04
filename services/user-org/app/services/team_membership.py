"""Shared team-member management logic for corporations + contractors.

Centralising the delete flow here so corp + contractor routers don't
diverge on guards (sole-owner protection, role gate, cascade to
notification recipients).
"""
from typing import Optional
from fastapi import HTTPException

from app.db import get_db


def _ensure_caller_can_manage(
    cur,
    entity_type: str,
    entity_id: str,
    caller_user_id: Optional[str],
    caller_role: Optional[str],
):
    """Caller must be platform admin OR an admin/owner member of this entity."""
    if caller_role == "admin":
        return
    if not caller_user_id:
        raise HTTPException(status_code=401, detail="auth_required")

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
                "code":    "forbidden_member_manage",
                "message": "רק מנהל או בעלים של הארגון יכולים לערוך את חברי הצוות.",
            },
        )


def delete_membership(
    entity_type: str,
    entity_id: str,
    membership_id: str,
    caller_user_id: Optional[str],
    caller_role: Optional[str],
) -> dict:
    """Hard-delete an entity_memberships row + clean up the
    notification_recipients row for the same (entity, user) tuple."""
    conn = get_db()
    try:
        cur = conn.cursor()
        _ensure_caller_can_manage(cur, entity_type, entity_id, caller_user_id, caller_role)

        cur.execute(
            """SELECT membership_id, user_id, role
               FROM auth_db.entity_memberships
               WHERE membership_id = %s
                 AND entity_type   = %s
                 AND entity_id     = %s
               LIMIT 1""",
            (membership_id, entity_type, entity_id),
        )
        target = cur.fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="membership_not_found")

        # Protect the only remaining owner — an org with zero owners is
        # an org no one can administer. Pending invites (user_id NULL)
        # never satisfy this guard since they aren't yet owners.
        if target.get("role") == "owner":
            cur.execute(
                """SELECT COUNT(*) AS cnt FROM auth_db.entity_memberships
                   WHERE entity_type = %s AND entity_id = %s
                     AND role = 'owner' AND is_active = TRUE
                     AND membership_id <> %s""",
                (entity_type, entity_id, membership_id),
            )
            other_owners = int(cur.fetchone()["cnt"])
            if other_owners == 0:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code":    "cannot_remove_sole_owner",
                        "message": "אי אפשר למחוק את הבעלים האחרון של הארגון. הוסף בעלים נוסף קודם.",
                    },
                )

        # Cascade: drop the notification_recipients row for this user
        # on this entity. Pending invites have user_id NULL so this
        # is a no-op for them.
        if target.get("user_id"):
            cur.execute(
                """DELETE FROM auth_db.notification_recipients
                   WHERE entity_type = %s AND entity_id = %s AND user_id = %s""",
                (entity_type, entity_id, target["user_id"]),
            )

        cur.execute(
            "DELETE FROM auth_db.entity_memberships WHERE membership_id = %s",
            (membership_id,),
        )
        conn.commit()

        return {"deleted": True, "membership_id": membership_id}
    finally:
        conn.close()
