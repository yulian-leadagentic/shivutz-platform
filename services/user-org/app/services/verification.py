"""Contractor verification orchestrator.

Pulls together:
  - Israeli ID checksum validation (`israeli_id`)
  - Live data.gov.il lookups (`data_gov_il`)
  - Token issue / confirm against `verification_tokens`
  - Tier transitions on the `contractors` row

Three tiers:
  tier_0 — phone-OTP only, no registry binding
  tier_1 — found in פנקס הקבלנים (and רשם החברות says פעילה) but no
           contact-channel binding yet
  tier_2 — bound via email link, SMS OTP, or manual admin approval

The blocked-company case (ica says מחוקה / בפירוק) does not become a
contractor record at all — `quick_lookup` flags it and the registration
endpoint refuses to create.
"""
import hashlib
import logging
import secrets
from datetime import datetime, timedelta
from typing import Any, Literal, Optional

from app.db import get_db
from app.integrations import data_gov_il
from app.integrations.israeli_id import is_valid_israeli_id

log = logging.getLogger(__name__)

TOKEN_TTL = timedelta(minutes=30)
REVALIDATE_PERIOD = timedelta(days=183)  # ~6 months

Channel = Literal["email", "sms"]


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _hash_sms_code(code: str) -> str:
    return hashlib.sha256(("sms:" + code).encode()).hexdigest()


async def quick_lookup(business_number: str) -> dict[str, Any]:
    """Validate + cross-check the business number against both registries.

    Returns a structured payload the frontend consumes directly:
      {
        ok: bool,
        blocked: bool,                      # company is מחוקה / בפירוק
        block_reason: str | None,
        pinkash_found, ica_found: bool,
        gov_company_status: str | None,
        prefill: {company_name_he, kvutza, sivug, gov_branch, kablan_number},
        channels: [{type, target}],         # email/sms options to verify with
      }
    """
    if not is_valid_israeli_id(business_number):
        return {
            "ok": False,
            "error": "invalid_business_number",
            "message": "מספר ע.מ / ח.פ אינו תקין (checksum נכשל)",
        }

    result = await data_gov_il.lookup(business_number)

    pinkash_fields = data_gov_il.extract_pinkash_fields(result["pinkash"]) if result["pinkash"] else {}
    ica_fields = data_gov_il.extract_ica_fields(result["ica"]) if result["ica"] else {}

    company_active = data_gov_il.is_company_active(result["ica"])
    blocked = result["ica_found"] and company_active is False
    block_reason = ica_fields.get("gov_company_status") if blocked else None

    channels = []
    if pinkash_fields.get("email"):
        channels.append({"type": "email", "target": pinkash_fields["email"]})
    if pinkash_fields.get("phone"):
        channels.append({"type": "sms", "target": pinkash_fields["phone"]})

    return {
        "ok": True,
        "blocked": blocked,
        "block_reason": block_reason,
        "pinkash_found": result["pinkash_found"],
        "ica_found": result["ica_found"],
        "gov_company_status": ica_fields.get("gov_company_status"),
        "prefill": {
            "company_name_he": pinkash_fields.get("company_name_he") or ica_fields.get("company_name_he"),
            "kvutza": pinkash_fields.get("kvutza"),
            "sivug": pinkash_fields.get("sivug"),
            "gov_branch": pinkash_fields.get("gov_branch"),
            "kablan_number": pinkash_fields.get("kablan_number"),
        },
        "channels": channels,
        "from_cache": result["from_cache"],
    }


def initial_tier_for(pinkash_found: bool, ica_found: bool, company_active: Optional[bool]) -> str:
    """Tier the contractor row gets at creation time, before any channel verification."""
    if pinkash_found and (company_active is None or company_active):
        return "tier_1"
    if ica_found and company_active:
        return "tier_1"
    return "tier_0"


def start_verification(
    contractor_id: str,
    channel: Channel,
    target: str,
) -> dict[str, Any]:
    """Issue a verification token and return what the notification layer needs to send.

    Caller is responsible for actually publishing the notification event with
    these fields. We don't publish from here so the integration boundary stays
    visible at the route handler.
    """
    # Confirm the requested target matches what the registry returned for this contractor.
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT business_number, contact_name FROM contractors WHERE id = %s AND deleted_at IS NULL",
            (contractor_id,),
        )
        contractor = cur.fetchone()
        if not contractor:
            return {"ok": False, "error": "contractor_not_found"}

        cur.execute(
            "SELECT pinkash_payload FROM gov_registry_cache WHERE business_number = %s",
            (contractor["business_number"],),
        )
        cache_row = cur.fetchone()
        if not cache_row or not cache_row["pinkash_payload"]:
            return {"ok": False, "error": "no_registry_record"}
        pinkash = cache_row["pinkash_payload"]
        if isinstance(pinkash, str):
            import json
            pinkash = json.loads(pinkash)
        fields = data_gov_il.extract_pinkash_fields(pinkash)

        registry_target = fields.get("email") if channel == "email" else fields.get("phone")
        if not registry_target or registry_target.lower() != target.lower():
            return {"ok": False, "error": "target_mismatch"}

        # Issue a fresh token; invalidate any prior unused tokens on the same channel.
        cur.execute(
            """UPDATE verification_tokens
               SET used_at = NOW()
               WHERE contractor_id = %s AND channel = %s AND used_at IS NULL""",
            (contractor_id, channel),
        )

        if channel == "sms":
            code = f"{secrets.randbelow(10**6):06d}"
            token_hash = _hash_sms_code(code)
            send_payload = {"code": code}
        else:
            raw_token = secrets.token_urlsafe(32)
            token_hash = _hash_token(raw_token)
            send_payload = {"token": raw_token}

        expires_at = datetime.utcnow() + TOKEN_TTL
        cur.execute(
            """INSERT INTO verification_tokens
                 (contractor_id, channel, token_hash, target, expires_at)
               VALUES (%s, %s, %s, %s, %s)""",
            (contractor_id, channel, token_hash, target, expires_at),
        )
        conn.commit()

        return {
            "ok": True,
            "channel": channel,
            "target": target,
            "expires_at": expires_at.isoformat() + "Z",
            "send": send_payload,
            "contact_name": contractor.get("contact_name"),
        }
    finally:
        conn.close()


def confirm_verification(
    contractor_id: str,
    channel: Channel,
    secret: str,
) -> dict[str, Any]:
    """Validate a code/token; on success bump the contractor to tier_2."""
    if channel == "sms":
        token_hash = _hash_sms_code(secret)
    else:
        token_hash = _hash_token(secret)

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT id, expires_at, used_at
               FROM verification_tokens
               WHERE contractor_id = %s AND channel = %s AND token_hash = %s
               ORDER BY created_at DESC LIMIT 1""",
            (contractor_id, channel, token_hash),
        )
        token = cur.fetchone()
        if not token:
            return {"ok": False, "error": "invalid_token"}
        if token["used_at"] is not None:
            return {"ok": False, "error": "already_used"}
        if token["expires_at"] < datetime.utcnow():
            return {"ok": False, "error": "expired"}

        now = datetime.utcnow()
        cur.execute(
            "UPDATE verification_tokens SET used_at = %s WHERE id = %s",
            (now, token["id"]),
        )
        cur.execute(
            """UPDATE contractors
               SET verification_tier   = 'tier_2',
                   verification_method = %s,
                   verified_at         = %s,
                   revalidate_at       = %s,
                   approval_status     = 'approved',
                   approved_at         = COALESCE(approved_at, %s)
               WHERE id = %s""",
            (channel, now, now + REVALIDATE_PERIOD, now, contractor_id),
        )
        conn.commit()
        return {"ok": True, "tier": "tier_2", "method": channel}
    finally:
        conn.close()


def manual_approve(contractor_id: str, admin_user_id: str) -> dict[str, Any]:
    """Admin path — bumps to tier_2 with method='manual'."""
    now = datetime.utcnow()
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """UPDATE contractors
               SET verification_tier   = 'tier_2',
                   verification_method = 'manual',
                   verified_at         = %s,
                   revalidate_at       = %s,
                   approval_status     = 'approved',
                   approved_by_user_id = %s,
                   approved_at         = %s
               WHERE id = %s""",
            (now, now + REVALIDATE_PERIOD, admin_user_id, now, contractor_id),
        )
        conn.commit()
        return {"ok": True, "tier": "tier_2", "method": "manual"}
    finally:
        conn.close()
