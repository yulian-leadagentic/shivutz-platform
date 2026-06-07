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


def _digits_only(s: Optional[str]) -> str:
    """Strip everything but digits. Used for kablan-number comparison so
    leading zeros, dashes, or stray whitespace don't cause false misses
    (registry returns '03842', user might type '3842' or '03842' or
    '03-842')."""
    if not s:
        return ""
    return "".join(c for c in str(s) if c.isdigit())


async def verify_kablan_match(
    business_number: str,
    entered_kablan: str,
    owner_phone: Optional[str] = None,
    owner_email: Optional[str] = None,
) -> dict[str, Any]:
    """Confirm the kablan_number the user typed actually belongs to them.

    Two paths, tried in order — both produce match=True only when we
    can prove the kablan belongs to this user:

      Path A — ח.פ-keyed lookup (companies)
        Lookup פנקס הקבלנים by MISPAR_YESHUT = business_number. If a row
        exists, compare its MISPAR_KABLAN to entered_kablan.

      Path B — kablan-keyed fallback (sole proprietors)
        Many יחיד / עוסק-מורשה kablanim have an EMPTY MISPAR_YESHUT in
        the public dataset, so path A always misses them. We then
        lookup by MISPAR_KABLAN directly. If we find a row:
          - MISPAR_YESHUT matches our business_number → match.
          - MISPAR_YESHUT populated but different      → mismatch.
          - MISPAR_YESHUT empty (sole prop)            → cross-check
            owner_phone against MISPAR_TEL (canonical 9-digit
            subscriber compare, so 0542… / +972542… / 542… all match)
            OR owner_email against EMAIL (case-insensitive). Either
            channel matching = strong proof of identity.

    Network failures bubble up as ok=False so callers can route to
    manual approval rather than blocking the user. All other paths
    return ok=True with a `reason` so the UI can show a specific
    message instead of a generic "pending".

    Returns:
        {
          ok:              bool,
          match:           bool,
          registry_kablan: str | None,   # what פנקס הקבלנים has on file
          method:          str | None,   # business_number_match | phone_match | email_match
          reason:          str | None,   # only on match=False
          pinkash_row:     dict | None,  # raw registry row (when located)
          pinkash_fields:  dict | None,  # extracted fields (when located)
        }
    """
    entered_norm = _digits_only(entered_kablan)
    bn_norm = _digits_only(business_number)
    if not entered_norm:
        return {"ok": True, "match": False, "registry_kablan": None, "reason": "empty_input"}

    # `pinkash_row` and `pinkash_fields` are threaded through every
    # return where we located a registry row, so the caller can
    # snapshot them onto the contractors row regardless of which path
    # produced the match. Both are None when no row was found.
    pinkash_row: Optional[dict] = None
    pinkash_fields: Optional[dict] = None

    def _resp(**kw) -> dict[str, Any]:
        kw.setdefault("ok", True)
        kw.setdefault("pinkash_row", pinkash_row)
        kw.setdefault("pinkash_fields", pinkash_fields)
        return kw

    # ── Path A — by ח.פ ───────────────────────────────────────────────
    try:
        result = await data_gov_il.lookup(business_number)
    except Exception as e:
        log.warning("verify_kablan_match: data.gov.il lookup failed for %s: %s", business_number, e)
        return _resp(ok=False, match=False, registry_kablan=None, reason="registry_unreachable")

    if result["pinkash_found"] and result["pinkash"]:
        pinkash_row = result["pinkash"]
        pinkash_fields = data_gov_il.extract_pinkash_fields(pinkash_row)
        registry_norm = _digits_only(pinkash_fields.get("kablan_number"))
        if registry_norm and registry_norm == entered_norm:
            return _resp(
                match=True,
                registry_kablan=pinkash_fields.get("kablan_number"),
                method="business_number_match",
            )
        # ח.פ is registered but the kablan doesn't match what the user
        # typed — definite mismatch, no point falling through.
        return _resp(
            match=False,
            registry_kablan=pinkash_fields.get("kablan_number"),
            reason="kablan_mismatch",
        )

    # ── Path B — by kablan number (sole-proprietor fallback) ─────────
    try:
        kablan_row = await data_gov_il.lookup_by_kablan(entered_norm)
    except Exception as e:
        log.warning("verify_kablan_match: lookup_by_kablan failed for %s: %s", entered_norm, e)
        return _resp(ok=False, match=False, registry_kablan=None, reason="registry_unreachable")

    if not kablan_row:
        return _resp(match=False, registry_kablan=None, reason="kablan_not_found")

    pinkash_row = kablan_row
    pinkash_fields = data_gov_il.extract_pinkash_fields(kablan_row)
    registry_yeshut = _digits_only(kablan_row.get("MISPAR_YESHUT"))

    # Kablan record has a ח.פ that matches the user's — strong match.
    if registry_yeshut and registry_yeshut == bn_norm:
        return _resp(
            match=True,
            registry_kablan=pinkash_fields.get("kablan_number"),
            method="business_number_match",
        )

    # Kablan record has a different ח.פ — the user is claiming someone
    # else's license.
    if registry_yeshut and registry_yeshut != bn_norm:
        return _resp(
            match=False,
            registry_kablan=pinkash_fields.get("kablan_number"),
            reason="business_number_mismatch",
        )

    # Sole-prop case: MISPAR_YESHUT empty. Try phone match first
    # (strongest because the phone was OTP-verified at signup), then
    # email match. Either is enough — both compare the user's
    # registration channel against what the registry lists.

    # Phone match — canonical 9-digit subscriber compare. Handles
    # +972, leading 0, dashes, spaces on either side.
    if owner_phone:
        reg_canon = data_gov_il.canonical_il_phone(pinkash_fields.get("phone"))
        own_canon = data_gov_il.canonical_il_phone(owner_phone)
        if reg_canon and own_canon and reg_canon == own_canon:
            return _resp(
                match=True,
                registry_kablan=pinkash_fields.get("kablan_number"),
                method="phone_match",
            )

    # Email match — case-insensitive, trimmed.
    if owner_email and pinkash_fields.get("email"):
        if owner_email.strip().lower() == pinkash_fields["email"].strip().lower():
            return _resp(
                match=True,
                registry_kablan=pinkash_fields.get("kablan_number"),
                method="email_match",
            )

    # Neither phone nor email matched — admin queue. Report which
    # channels were available so the admin (and the user later) knows
    # what to retry with.
    available_channels = []
    if pinkash_fields.get("phone"):
        available_channels.append("phone")
    if pinkash_fields.get("email"):
        available_channels.append("email")
    return _resp(
        match=False,
        registry_kablan=pinkash_fields.get("kablan_number"),
        reason="sole_prop_contact_mismatch" if (owner_phone or owner_email) else "sole_prop_needs_contact",
        available_channels=available_channels,
    )


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


def kablan_match_approve(contractor_id: str) -> dict[str, Any]:
    """Self-serve path — bumps to tier_2 with method='kablan_match'.

    Called from POST /contractors (registration with matching kablan)
    and POST /contractors/{id}/verify-kablan (backfill flow). Same
    side-effects as manual_approve except we record HOW the contractor
    proved their identity (kablan_match vs admin click).
    """
    now = datetime.utcnow()
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """UPDATE contractors
               SET verification_tier   = 'tier_2',
                   verification_method = 'kablan_match',
                   verified_at         = COALESCE(verified_at, %s),
                   kablan_verified_at  = %s,
                   revalidate_at       = %s,
                   approval_status     = 'approved',
                   approved_at         = COALESCE(approved_at, %s)
               WHERE id = %s""",
            (now, now, now + REVALIDATE_PERIOD, now, contractor_id),
        )
        conn.commit()
        return {"ok": True, "tier": "tier_2", "method": "kablan_match"}
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
