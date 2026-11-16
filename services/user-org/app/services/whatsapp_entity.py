"""R38 · the entity a user's phone speaks for on WhatsApp.

A WhatsApp message carries a phone number and nothing else, so the chat
needs one entity per user to search as:

  one active membership    that one, no choice needed
  several                  the one flagged is_whatsapp_default
  several, none flagged    the chat asks the user to pick on the site

The flag lives on auth_db.entity_memberships (migration 110), and the
schema keeps it on at most one active, accepted row per user. Removing
a membership removes its flag with the row. Code that deactivates a
membership has to clear the flag in the same UPDATE: MySQL refuses the
UPDATE otherwise (chk_whatsapp_default_live).

The notification service reads the flag directly in its own sender
lookup (services/notification/src/whatsapp/handleInbound.js).
"""
from typing import Optional

from fastapi import HTTPException


def _memberships(cur, user_id: str) -> list:
    cur.execute(
        """SELECT em.membership_id, em.entity_type, em.entity_id, em.role,
                  em.is_whatsapp_default,
                  COALESCE(c.company_name_he, c.company_name,
                           co.company_name_he, co.company_name,
                           sp.name) AS entity_name
             FROM auth_db.entity_memberships em
             LEFT JOIN contractors c        ON em.entity_type = 'contractor'       AND c.id  = em.entity_id
             LEFT JOIN corporations co      ON em.entity_type = 'corporation'      AND co.id = em.entity_id
             LEFT JOIN service_providers sp ON em.entity_type = 'service_provider' AND sp.id = em.entity_id
            WHERE em.user_id = %s
              AND em.is_active = TRUE
              AND em.invitation_accepted_at IS NOT NULL
            ORDER BY em.created_at, em.membership_id""",
        (user_id,),
    )
    return cur.fetchall() or []


def describe(cur, user_id: str) -> dict:
    rows = _memberships(cur, user_id)
    default = next((r["membership_id"] for r in rows if r.get("is_whatsapp_default")), None)
    effective = rows[0]["membership_id"] if len(rows) == 1 else default
    return {
        "user_id": user_id,
        "memberships": [
            {
                "membership_id": r["membership_id"],
                "entity_type":   r["entity_type"],
                "entity_id":     r["entity_id"],
                "entity_name":   r.get("entity_name"),
                "role":          r.get("role"),
            }
            for r in rows
        ],
        "default_membership_id":   default,
        "effective_membership_id": effective,
        "choice_needed":           len(rows) > 1 and default is None,
    }


def set_default(conn, user_id: str, membership_id: Optional[str]) -> dict:
    """Point the user's default at one of his own active, accepted
    memberships, or clear it with None. Two statements: MySQL checks the
    unique key row by row, so moving the flag in one UPDATE could meet
    the old flag still in place."""
    cur = conn.cursor()
    if membership_id is not None:
        owned = {r["membership_id"] for r in _memberships(cur, user_id)}
        if membership_id not in owned:
            raise HTTPException(
                status_code=404,
                detail={
                    "code":    "membership_not_found",
                    "message": "החשבון הזה לא נמצא בין החשבונות הפעילים של המשתמש.",
                },
            )

    cur.execute(
        """UPDATE auth_db.entity_memberships
              SET is_whatsapp_default = FALSE
            WHERE user_id = %s AND is_whatsapp_default = TRUE""",
        (user_id,),
    )
    if membership_id is not None:
        cur.execute(
            """UPDATE auth_db.entity_memberships
                  SET is_whatsapp_default = TRUE
                WHERE membership_id = %s
                  AND user_id = %s
                  AND is_active = TRUE
                  AND invitation_accepted_at IS NOT NULL""",
            (membership_id, user_id),
        )
        if cur.rowcount != 1:
            conn.rollback()
            raise HTTPException(
                status_code=409,
                detail={
                    "code":    "membership_changed",
                    "message": "החשבון השתנה בזמן השמירה. רעננו את הדף ונסו שוב.",
                },
            )
    conn.commit()
    return describe(cur, user_id)
