"""Membership-request flow — inverted invite for duplicate-ח.פ registrations.

When a new user attempts to register a corp/contractor whose business
number is already on file with an active org row, this module:

  1. Looks up the existing org's owner(s).
  2. Creates a `membership_requests` row capturing what the new user
     typed (phone, name, email).
  3. Returns the dispatch payload the route handler then publishes to
     `team.membership_request.created` so the notification service
     sends SMS/WhatsApp to the existing owner(s) with a magic link.

The route handler raises 409 with a structured error after calling
this so the frontend shows a friendly 'התאגיד כבר רשום' screen.
"""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta
from typing import Optional

from app.db import get_db


REQUEST_TTL_DAYS = 7


def find_existing_active_org(business_number: str, org_type: str) -> Optional[dict]:
    """Returns the existing org row (id + company_name_he) if any active
    corp/contractor already uses this business_number. None otherwise."""
    table = "contractors" if org_type == "contractor" else "corporations"
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            f"""SELECT id, company_name_he, company_name, approval_status
                FROM {table}
                WHERE business_number = %s AND deleted_at IS NULL
                LIMIT 1""",
            (business_number,),
        )
        return cur.fetchone()
    finally:
        conn.close()


def owners_for(entity_type: str, entity_id: str) -> list[dict]:
    """All active owners of the entity, with their phone + name + email
    so the route handler can fan SMS/WhatsApp/email out to all of them.
    A platform-admin override path lives elsewhere — this only returns
    role='owner' members.
    """
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT em.user_id, u.phone, u.full_name, u.email
               FROM auth_db.entity_memberships em
               JOIN auth_db.users u ON u.id = em.user_id
               WHERE em.entity_type = %s
                 AND em.entity_id   = %s
                 AND em.role        = 'owner'
                 AND em.is_active   = TRUE""",
            (entity_type, entity_id),
        )
        return cur.fetchall()
    finally:
        conn.close()


def create_request(
    entity_type: str,
    entity_id: str,
    requester_phone: str,
    requester_name: str,
    requester_email: Optional[str],
    requested_role: str = "admin",
) -> dict:
    """Insert a new pending membership_request and return the row +
    the freshly-generated approval_token (32 url-safe chars)."""
    request_id = str(uuid.uuid4())
    token = secrets.token_urlsafe(32)
    expires_at = datetime.utcnow() + timedelta(days=REQUEST_TTL_DAYS)
    conn = get_db()
    try:
        cur = conn.cursor()
        # Cancel any older pending requests from the same phone for the
        # same entity — most recent intent wins, and we don't want to
        # spam the owner with multiple SMS for the same person.
        cur.execute(
            """UPDATE auth_db.membership_requests
                  SET status = 'expired'
                WHERE entity_type = %s AND entity_id = %s
                  AND requester_phone = %s
                  AND status = 'pending'""",
            (entity_type, entity_id, requester_phone),
        )
        cur.execute(
            """INSERT INTO auth_db.membership_requests
                 (id, entity_type, entity_id,
                  requester_phone, requester_name, requester_email,
                  requested_role, approval_token, expires_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (request_id, entity_type, entity_id,
             requester_phone, requester_name, requester_email,
             requested_role, token, expires_at),
        )
        conn.commit()
        return {
            "id": request_id,
            "approval_token": token,
            "expires_at": expires_at.isoformat() + "Z",
        }
    finally:
        conn.close()


def get_by_token(token: str) -> Optional[dict]:
    """Return the membership_request row by its approval_token, plus
    a join to the entity name/type so the approve page can render
    'אנא אשר את [שם] לתאגיד [שם]'."""
    if not token:
        return None
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT mr.*
               FROM auth_db.membership_requests mr
               WHERE mr.approval_token = %s
               LIMIT 1""",
            (token,),
        )
        row = cur.fetchone()
        if not row:
            return None
        # Convert datetimes to ISO for JSON serialisation.
        for k, v in list(row.items()):
            if hasattr(v, "isoformat"):
                row[k] = v.isoformat()
        # Auto-expire if pending and past expires_at — saves a cron.
        if row.get("status") == "pending":
            now = datetime.utcnow().isoformat()
            if row.get("expires_at") and row["expires_at"] < now:
                cur.execute(
                    "UPDATE auth_db.membership_requests SET status = 'expired' WHERE id = %s",
                    (row["id"],),
                )
                conn.commit()
                row["status"] = "expired"
        # Look up the entity's display name from the right table.
        table = "org_db.contractors" if row["entity_type"] == "contractor" else "org_db.corporations"
        cur.execute(
            f"SELECT company_name_he, company_name FROM {table} WHERE id = %s AND deleted_at IS NULL",
            (row["entity_id"],),
        )
        ent = cur.fetchone()
        row["entity_name"] = (ent or {}).get("company_name_he") or (ent or {}).get("company_name")
        return row
    finally:
        conn.close()


def approve(token: str, approving_user_id: str) -> dict:
    """Owner clicks approve. Side-effects:
       1. Find or create a users row for the requester_phone.
       2. Insert an active entity_memberships row.
       3. Mark the request approved.
    Returns the created membership_id + requester info so the route
    can publish a 'team.membership_request.approved' event for the
    confirmation SMS.
    """
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM auth_db.membership_requests WHERE approval_token = %s LIMIT 1",
            (token,),
        )
        req = cur.fetchone()
        if not req:
            return {"ok": False, "error": "request_not_found"}
        if req["status"] != "pending":
            return {"ok": False, "error": f"request_{req['status']}"}

        # Verify the approver is actually an owner of the target entity.
        cur.execute(
            """SELECT 1
               FROM auth_db.entity_memberships
               WHERE entity_type = %s AND entity_id = %s
                 AND user_id = %s AND role = 'owner' AND is_active = TRUE
               LIMIT 1""",
            (req["entity_type"], req["entity_id"], approving_user_id),
        )
        if not cur.fetchone():
            return {"ok": False, "error": "not_authorized"}

        # Find or create the requester's user row.
        cur.execute(
            "SELECT id FROM auth_db.users WHERE phone = %s AND deleted_at IS NULL LIMIT 1",
            (req["requester_phone"],),
        )
        existing = cur.fetchone()
        if existing:
            user_id = existing["id"]
        else:
            user_id = str(uuid.uuid4())
            org_role = "contractor" if req["entity_type"] == "contractor" else "corporation"
            cur.execute(
                """INSERT INTO auth_db.users (id, phone, full_name, role, auth_method)
                   VALUES (%s, %s, %s, %s, 'sms')""",
                (user_id, req["requester_phone"], req["requester_name"], org_role),
            )

        # Create the active entity_memberships row.
        membership_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO auth_db.entity_memberships
                 (membership_id, user_id, entity_type, entity_id, role,
                  invited_by, invitation_accepted_at, is_active)
               VALUES (%s, %s, %s, %s, %s, %s, NOW(), TRUE)""",
            (membership_id, user_id, req["entity_type"], req["entity_id"],
             req["requested_role"], approving_user_id),
        )

        # Mark the request approved.
        cur.execute(
            """UPDATE auth_db.membership_requests
                  SET status = 'approved',
                      approved_by_user_id = %s,
                      approved_at = NOW(),
                      created_membership_id = %s
                WHERE id = %s""",
            (approving_user_id, membership_id, req["id"]),
        )
        conn.commit()

        return {
            "ok": True,
            "membership_id": membership_id,
            "user_id": user_id,
            "requester_phone": req["requester_phone"],
            "requester_name":  req["requester_name"],
            "entity_type":     req["entity_type"],
            "entity_id":       req["entity_id"],
        }
    finally:
        conn.close()


def reject(token: str, rejecting_user_id: str, reason: Optional[str]) -> dict:
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM auth_db.membership_requests WHERE approval_token = %s LIMIT 1",
            (token,),
        )
        req = cur.fetchone()
        if not req:
            return {"ok": False, "error": "request_not_found"}
        if req["status"] != "pending":
            return {"ok": False, "error": f"request_{req['status']}"}
        # Authorization check same as approve.
        cur.execute(
            """SELECT 1
               FROM auth_db.entity_memberships
               WHERE entity_type = %s AND entity_id = %s
                 AND user_id = %s AND role = 'owner' AND is_active = TRUE
               LIMIT 1""",
            (req["entity_type"], req["entity_id"], rejecting_user_id),
        )
        if not cur.fetchone():
            return {"ok": False, "error": "not_authorized"}
        cur.execute(
            """UPDATE auth_db.membership_requests
                  SET status = 'rejected',
                      rejected_at = NOW(),
                      rejection_reason = %s
                WHERE id = %s""",
            (reason, req["id"]),
        )
        conn.commit()
        return {
            "ok": True,
            "requester_phone": req["requester_phone"],
            "requester_name":  req["requester_name"],
            "entity_type":     req["entity_type"],
            "entity_id":       req["entity_id"],
        }
    finally:
        conn.close()
