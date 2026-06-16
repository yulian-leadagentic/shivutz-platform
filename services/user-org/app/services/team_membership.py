"""Shared team-member management logic for corporations + contractors.

Centralising the delete + update flows here so corp + contractor routers
don't diverge on guards (sole-owner protection, role gate, cascade to
notification recipients).
"""
from typing import Optional, Dict, Any
from fastapi import HTTPException

from app.db import get_db
from app.publisher import publish_event


ALLOWED_ROLES = {"owner", "admin", "viewer"}


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


async def update_membership(
    entity_type: str,
    entity_id: str,
    membership_id: str,
    patch: Dict[str, Any],
    caller_user_id: Optional[str],
    caller_role: Optional[str],
    entity_name: Optional[str] = None,
) -> dict:
    """Update a team membership in place.

    Active members  (user_id IS NOT NULL) → role + job_title only.
    Pending invites (user_id IS NULL)     → role + job_title + invited
        first/last name + invited_phone. If invited_phone changes, we
        publish team.invited again so the invitee gets a fresh SMS at
        the new number — the existing invite_token is reused so the
        old link continues to work too.

    Sole-owner protection: demoting the last remaining owner is a 409.
    Caller must be admin/owner of the entity (or platform admin).
    """
    role         = patch.get("role")
    job_title    = patch.get("job_title")        # may be ""/None to clear
    first_name   = patch.get("invited_first_name")
    last_name    = patch.get("invited_last_name")
    phone        = patch.get("invited_phone")
    email        = patch.get("email")            # may be "" to clear, None to leave

    # Sanity-check the role value before any DB work.
    if role is not None and role not in ALLOWED_ROLES:
        raise HTTPException(status_code=400, detail="invalid_role")

    # Quick email sanity-check — accept clear ("") or basic shape.
    if email is not None and email.strip():
        if "@" not in email or "." not in email.split("@")[-1]:
            raise HTTPException(status_code=400, detail="invalid_email")

    conn = get_db()
    publish_phone_change = None  # set if we need to send a fresh invite SMS
    try:
        cur = conn.cursor()
        _ensure_caller_can_manage(cur, entity_type, entity_id, caller_user_id, caller_role)

        cur.execute(
            """SELECT membership_id, user_id, role, invited_phone,
                      invitation_token, invitation_accepted_at,
                      invited_first_name, invited_last_name
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

        is_pending = target["user_id"] is None

        # ── Sole-owner guard: only fires when an active owner is being
        # demoted to a non-owner role. Demotion of a pending owner (no
        # user_id yet) is harmless because they can't admin anything.
        if (
            role is not None
            and role != "owner"
            and target["role"] == "owner"
            and not is_pending
        ):
            cur.execute(
                """SELECT COUNT(*) AS cnt FROM auth_db.entity_memberships
                   WHERE entity_type = %s AND entity_id = %s
                     AND role = 'owner' AND is_active = TRUE
                     AND membership_id <> %s""",
                (entity_type, entity_id, membership_id),
            )
            if int(cur.fetchone()["cnt"]) == 0:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code":    "cannot_demote_sole_owner",
                        "message": "אי אפשר להוריד את הבעלים האחרון. הוסף בעלים נוסף קודם.",
                    },
                )

        # ── Build the dynamic UPDATE.
        sets: list = []
        params: list = []

        if role is not None:
            sets.append("role = %s")
            params.append(role)

        # job_title: explicit None means "leave unchanged"; empty string
        # means "clear it". Skip the field entirely if not in the patch.
        if "job_title" in patch:
            sets.append("job_title = %s")
            params.append(job_title if (job_title is not None and job_title != "") else None)

        if is_pending:
            if "invited_first_name" in patch:
                sets.append("invited_first_name = %s")
                params.append((first_name or "").strip() or None)
            if "invited_last_name" in patch:
                sets.append("invited_last_name = %s")
                params.append((last_name or "").strip() or None)
            if "invited_phone" in patch:
                new_phone = (phone or "").strip() or None
                sets.append("invited_phone = %s")
                params.append(new_phone)
                if new_phone and new_phone != (target.get("invited_phone") or None):
                    # We'll fire the SMS after commit. Reuses the same
                    # invitation_token so the old link still works.
                    publish_phone_change = {
                        "phone":        new_phone,
                        "invite_token": target["invitation_token"],
                    }
            if "email" in patch:
                sets.append("invited_email = %s")
                params.append((email or "").strip() or None)
        else:
            # For active members we silently ignore fields that don't
            # apply (name/phone). They're owned by the users table.
            for forbidden in ("invited_first_name", "invited_last_name", "invited_phone"):
                if forbidden in patch:
                    pass
            # Email lives on auth_db.users for active members. We do that
            # UPDATE separately (different table) so we can surface the
            # UNIQUE-collision case as a 409 instead of a generic 500.
            if "email" in patch:
                new_email = (email or "").strip() or None
                user_id   = target["user_id"]
                if new_email is None:
                    cur.execute("UPDATE auth_db.users SET email = NULL WHERE id = %s", (user_id,))
                else:
                    try:
                        cur.execute(
                            "UPDATE auth_db.users SET email = %s WHERE id = %s",
                            (new_email, user_id),
                        )
                    except Exception as e:
                        # Duplicate-key (1062) → another user already has this email.
                        if "Duplicate entry" in str(e) or "1062" in str(e):
                            conn.rollback()
                            raise HTTPException(
                                status_code=409,
                                detail={
                                    "code":    "email_already_in_use",
                                    "message": "כתובת המייל הזו כבר רשומה אצל משתמש אחר.",
                                },
                            )
                        raise

        if not sets and "email" not in patch:
            return {"updated": False, "membership_id": membership_id}

        if sets:
            params.append(membership_id)
            cur.execute(
                f"UPDATE auth_db.entity_memberships SET {', '.join(sets)} WHERE membership_id = %s",
                tuple(params),
            )
        conn.commit()

        # Read back so the frontend can refresh the row without a list refetch.
        cur.execute(
            """SELECT em.membership_id, em.user_id, em.role, em.job_title,
                      em.is_active, em.invitation_accepted_at, em.created_at,
                      em.invited_first_name, em.invited_last_name,
                      COALESCE(u.phone, em.invited_phone) AS phone,
                      u.full_name,
                      COALESCE(u.email, em.invited_email) AS email
               FROM auth_db.entity_memberships em
               LEFT JOIN auth_db.users u ON u.id = em.user_id
               WHERE em.membership_id = %s""",
            (membership_id,),
        )
        updated = cur.fetchone() or {}
        for col in ("invitation_accepted_at", "created_at"):
            if hasattr(updated.get(col), "isoformat"):
                updated[col] = updated[col].isoformat()
        updated["pending"] = updated.get("invitation_accepted_at") is None
        if not updated.get("full_name") and (
            updated.get("invited_first_name") or updated.get("invited_last_name")
        ):
            updated["full_name"] = (
                f"{updated.get('invited_first_name','') or ''} "
                f"{updated.get('invited_last_name','') or ''}"
            ).strip()
    finally:
        conn.close()

    # Fire the fresh SMS *after* the DB write succeeds. team.invited is
    # the same routing key the original invite used, so the notification
    # consumer renders the standard accept-link template.
    if publish_phone_change is not None:
        await publish_event("team.invited", {
            "phone":        publish_phone_change["phone"],
            "entity_name":  entity_name or "",
            "entity_type":  entity_type,
            "role":         updated.get("role"),
            "invite_token": publish_phone_change["invite_token"],
            "inviter_name": entity_name or "המנהל",
        })

    return updated


# ── Deal-contact flag (per-membership) ──────────────────────────────
#
# Each entity must keep at least one active deal contact at all times,
# so the other party in a deal always has someone to reach. Toggle
# enforces this: unmarking the last remaining contact returns 409 and
# leaves the flag untouched.

def set_deal_contact(
    entity_type: str,
    entity_id: str,
    membership_id: str,
    is_deal_contact: bool,
    caller_user_id: Optional[str],
    caller_role: Optional[str],
) -> Dict[str, Any]:
    conn = get_db()
    try:
        cur = conn.cursor()
        _ensure_caller_can_manage(cur, entity_type, entity_id, caller_user_id, caller_role)

        # Sanity: the target membership belongs to the claimed entity
        # AND is active. Pending/disabled members can't be contacts.
        cur.execute(
            """SELECT membership_id, is_active, is_deal_contact
               FROM auth_db.entity_memberships
               WHERE membership_id = %s
                 AND entity_type   = %s
                 AND entity_id     = %s""",
            (membership_id, entity_type, entity_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="membership_not_found")
        if not row["is_active"]:
            raise HTTPException(
                status_code=409,
                detail={"code": "inactive_member",
                        "message": "חבר לא פעיל לא יכול לשמש כאיש קשר לעסקאות"},
            )

        # Min-1 guard: when unmarking, make sure SOME other active
        # member of this entity still carries the flag.
        if not is_deal_contact and row["is_deal_contact"]:
            cur.execute(
                """SELECT COUNT(*) AS c
                   FROM auth_db.entity_memberships
                   WHERE entity_type = %s
                     AND entity_id   = %s
                     AND is_active   = TRUE
                     AND is_deal_contact = TRUE
                     AND membership_id  <> %s""",
                (entity_type, entity_id, membership_id),
            )
            others = int((cur.fetchone() or {}).get("c") or 0)
            if others == 0:
                raise HTTPException(
                    status_code=409,
                    detail={"code": "need_at_least_one_contact",
                            "message": "חייב להישאר לפחות איש קשר אחד לעסקאות. סמן חבר אחר תחילה."},
                )

        cur.execute(
            """UPDATE auth_db.entity_memberships
               SET is_deal_contact = %s
               WHERE membership_id = %s""",
            (bool(is_deal_contact), membership_id),
        )
        conn.commit()

        return {"membership_id": membership_id, "is_deal_contact": bool(is_deal_contact)}
    finally:
        conn.close()


def list_deal_contacts(entity_type: str, entity_id: str) -> list[Dict[str, Any]]:
    """Return the entity's active deal contacts — name + phone + email
    of every member who's flagged. Used by the deal screens to show
    the other party "who to call". Pending invites are excluded.

    Empty list shouldn't happen in practice (migration backfills + API
    guarantees min-1) but if it does, the deal page falls back to the
    legacy contact_* fields on the entity row.
    """
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT em.membership_id,
                      em.job_title,
                      em.invited_first_name, em.invited_last_name,
                      COALESCE(u.phone, em.invited_phone) AS phone,
                      u.full_name,
                      COALESCE(u.email, em.invited_email) AS email
               FROM auth_db.entity_memberships em
               LEFT JOIN auth_db.users u ON u.id = em.user_id
               WHERE em.entity_type      = %s
                 AND em.entity_id        = %s
                 AND em.is_active        = TRUE
                 AND em.is_deal_contact  = TRUE
                 AND em.invitation_accepted_at IS NOT NULL
               ORDER BY em.created_at""",
            (entity_type, entity_id),
        )
        rows = cur.fetchall() or []
        for r in rows:
            if not r.get("full_name"):
                fn = r.get("invited_first_name") or ""
                ln = r.get("invited_last_name") or ""
                joined = f"{fn} {ln}".strip()
                if joined:
                    r["full_name"] = joined
        return rows
    finally:
        conn.close()
