"""Aggregate view for the admin /admin/orgs/{id} detail page.

GET /admin/orgs/{id}/summary?org_type=contractor|corporation

Pulls everything an admin needs to triage one org in a single round-trip:

  - The org row itself (so the frontend can render header + edit form
    without a second fetch).
  - Deal counts grouped by status (proposed / corp_committed / approved
    / closed / cancelled / disputed / ...).
  - Workers count (corporations only — counted from worker_db.workers).
  - Open worker-searches count (contractors only — from
    deal_db.worker_searches).
  - Team member count (active rows in auth_db.entity_memberships).
  - Gov data:
      * contractor → cached רשם החברות + פנקס הקבלנים rows
                     (from org_db.gov_registry_cache, keyed by business_number)
      * corporation → matching row from org_db.gov_corporations_registry
                      (the admin-uploaded רשות האוכלוסין PDF)
  - Recent 10 deals (with party-id resolution left to the frontend).
"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.db import get_db

router = APIRouter()


def _serialize(row: dict) -> dict:
    """Convert datetime fields to ISO strings + decode JSON columns."""
    out = {}
    for k, v in row.items():
        if hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


# Which party is blocking the deal moving forward, keyed by status.
# Mirrors STUCK_OWNER in admin/app/routes/deals.py — if the canonical
# map there changes, update both. We re-declare it here instead of
# importing because the two files live under the same service so the
# circular-import risk is low but the explicit duplication is clearer.
STUCK_OWNER = {
    "proposed":                 "corp",
    "corp_committed":           "contractor",
    "counter_proposed":         "contractor",
    "approved":                 "system",
    "accepted":                 "system",
    "active":                   "neither",
    "reporting":                "neither",
    "closed":                   "neither",
    "completed":                "neither",
    "cancelled":                "neither",
    "cancelled_by_corp":        "neither",
    "cancelled_by_contractor":  "neither",
    "rejected":                 "neither",
    "expired":                  "neither",
    "disputed":                 "admin",
}


def _deal_counts(deal_cur, org_id: str, org_type: str) -> dict:
    """Count deals grouped by status for this org."""
    col = "contractor_id" if org_type == "contractor" else "corporation_id"
    deal_cur.execute(
        f"""SELECT status, COUNT(*) AS n
            FROM deals
            WHERE {col} = %s AND deleted_at IS NULL
            GROUP BY status""",
        (org_id,),
    )
    counts = {r["status"]: int(r["n"]) for r in deal_cur.fetchall()}
    counts["total"] = sum(counts.values())
    return counts


def _recent_deals(deal_cur, org_id: str, org_type: str, limit: int = 10) -> list:
    """Last N deals for this org. Includes the bits the admin scans
    on each row: status, party ids, worker count (from deal_workers
    subquery — the old deals.workers_count column was dropped in
    migration 014), commission, key dates, and a derived stuck_on
    tag so the table shows 'waiting for whom' inline. Party-NAME
    enrichment happens in the calling route (it pulls from org_db).
    """
    col = "contractor_id" if org_type == "contractor" else "corporation_id"
    # Migration 024 renamed deals.request_line_item_id → search_id.
    deal_cur.execute(
        f"""SELECT d.id, d.status, d.contractor_id, d.corporation_id,
                   d.commission_amount,
                   d.search_id,
                   d.created_at, d.updated_at,
                   d.corp_committed_at, d.approved_at,
                   (SELECT COUNT(*) FROM deal_workers dw
                     WHERE dw.deal_id = d.id
                       AND dw.removed_at IS NULL) AS dw_count
            FROM deals d
            WHERE d.{col} = %s AND d.deleted_at IS NULL
            ORDER BY d.updated_at DESC, d.created_at DESC
            LIMIT %s""",
        (org_id, limit),
    )
    rows = [_serialize(r) for r in deal_cur.fetchall()]
    for r in rows:
        r["stuck_on"] = STUCK_OWNER.get(r.get("status") or "", "unknown")
        # Expose dw_count as workers_count so the frontend type stays
        # stable (the table column is labelled 'עובדים' and reads from
        # whichever number is non-null).
        r["workers_count"] = r.get("dw_count")
    return rows


def _enrich_recent_deals(rows: list, org_conn, org_id: str, org_type: str) -> None:
    """Add the OTHER party's name to each recent_deals row.

    For a contractor's org-detail page we already know the contractor
    is this org — what's interesting on each row is the corp on the
    other side (and vice versa). Mutates `rows` in place.
    """
    if not rows:
        return
    if org_type == "contractor":
        ids = list({r["corporation_id"] for r in rows if r.get("corporation_id")})
        table = "corporations"
        field = "corporation_id"
    else:
        ids = list({r["contractor_id"] for r in rows if r.get("contractor_id")})
        table = "contractors"
        field = "contractor_id"
    if not ids:
        return
    placeholders = ",".join(["%s"] * len(ids))
    cur = org_conn.cursor()
    cur.execute(
        f"""SELECT id, company_name_he, company_name
              FROM {table} WHERE id IN ({placeholders})""",
        ids,
    )
    name_by_id = {
        r["id"]: (r.get("company_name_he") or r.get("company_name") or "")
        for r in cur.fetchall()
    }
    for r in rows:
        oid = r.get(field)
        r["other_party_name"] = name_by_id.get(oid) or None


def _enrich_recent_deals_profession(rows: list, job_conn, worker_conn) -> None:
    """Pull profession_type + Hebrew label off the worker_searches
    behind each deal. Two-step lookup (job_db.worker_searches →
    worker_db.profession_types) but the admin sees 'מקצוע' on every
    row so the trade-off is worth it."""
    search_ids = list({r["search_id"] for r in rows if r.get("search_id")})
    if not search_ids:
        return
    ph = ",".join(["%s"] * len(search_ids))
    job_cur = job_conn.cursor()
    job_cur.execute(
        f"""SELECT id, profession_type, region
              FROM worker_searches WHERE id IN ({ph})""",
        search_ids,
    )
    search_by_id = {r["id"]: r for r in job_cur.fetchall()}

    prof_codes = list({s.get("profession_type") for s in search_by_id.values() if s.get("profession_type")})
    prof_he: dict = {}
    if prof_codes:
        wp = ",".join(["%s"] * len(prof_codes))
        w_cur = worker_conn.cursor()
        w_cur.execute(
            f"SELECT code, name_he FROM profession_types WHERE code IN ({wp})",
            prof_codes,
        )
        prof_he = {r["code"]: r["name_he"] for r in w_cur.fetchall()}

    for r in rows:
        s = search_by_id.get(r.get("search_id")) if r.get("search_id") else None
        r["profession_type"] = (s or {}).get("profession_type")
        r["profession_he"]   = prof_he.get((s or {}).get("profession_type"))
        r["region"]          = (s or {}).get("region")


def _team_member_count(auth_cur, org_id: str, org_type: str) -> int:
    auth_cur.execute(
        """SELECT COUNT(*) AS n
           FROM entity_memberships
           WHERE entity_type = %s AND entity_id = %s
             AND is_active = TRUE
             AND invitation_accepted_at IS NOT NULL""",
        (org_type, org_id),
    )
    row = auth_cur.fetchone()
    return int(row["n"]) if row else 0


def _workers_count(worker_cur, corp_id: str) -> dict:
    """Workers for a corp — total + per-status."""
    worker_cur.execute(
        """SELECT status, COUNT(*) AS n
           FROM workers
           WHERE corporation_id = %s AND deleted_at IS NULL
           GROUP BY status""",
        (corp_id,),
    )
    out = {"available": 0, "assigned": 0, "on_leave": 0, "deactivated": 0, "total": 0}
    for r in worker_cur.fetchall():
        s = r["status"]
        if s in out:
            out[s] = int(r["n"])
        out["total"] += int(r["n"])
    return out


def _open_searches_count(job_cur, contractor_id: str) -> int:
    """Open worker-search requests for this contractor.

    The worker_searches table lives in job_db (since migration 024
    renamed job_request_line_items → worker_searches inside job_db),
    not deal_db. Pass a job_db cursor.
    """
    job_cur.execute(
        """SELECT COUNT(*) AS n
           FROM worker_searches
           WHERE contractor_id = %s
             AND status IN ('open', 'partially_matched')""",
        (contractor_id,),
    )
    row = job_cur.fetchone()
    return int(row["n"]) if row else 0


def _canonical_il_phone(raw) -> Optional[str]:
    """Mirror of canonical_il_phone in user-org's data_gov_il integration.

    Reduce any Israeli phone format to its 9-digit subscriber number
    so '0542031484' / '+972542031484' / '542031484' all compare equal.
    Kept here (not imported) because admin and user-org are separate
    services — if the upstream helper changes, sync this manually.
    """
    if raw is None:
        return None
    digits = "".join(c for c in str(raw) if c.isdigit())
    if not digits:
        return None
    if digits.startswith("972"):
        digits = digits[3:]
    if digits.startswith("0"):
        digits = digits[1:]
    return digits if len(digits) == 9 else None


def _gov_contractor(org_cur, business_number: str) -> Optional[dict]:
    """Cached פנקס הקבלנים + רשם החברות payloads for this contractor's
    business_number. Returns the parsed fields (kablan_number, kvutza,
    sivug, gov_branch, registry-listed email/phone, ica status) rather
    than the raw JSON so the frontend doesn't need to decode anything."""
    if not business_number:
        return None
    org_cur.execute(
        """SELECT pinkash_payload, ica_payload,
                  pinkash_found, ica_found, fetched_at
           FROM gov_registry_cache
           WHERE business_number = %s""",
        (business_number,),
    )
    row = org_cur.fetchone()
    if not row:
        return None

    pinkash = row.get("pinkash_payload")
    ica = row.get("ica_payload")
    if isinstance(pinkash, str):
        try: pinkash = json.loads(pinkash)
        except Exception: pinkash = None
    if isinstance(ica, str):
        try: ica = json.loads(ica)
        except Exception: ica = None

    # Mirror the field extraction done in user-org/integrations/data_gov_il.py
    # We can't import that module from here (different service), so the
    # field names are restated; keep them in sync if the upstream extractor
    # changes.
    pinkash_fields = {}
    if pinkash:
        kvutza = (pinkash.get("KVUTZA") or "").strip() or None
        sivug_raw = pinkash.get("SIVUG")
        try:
            sivug = int(sivug_raw) if sivug_raw not in (None, "") else None
        except (ValueError, TypeError):
            sivug = None
        pinkash_fields = {
            "kablan_number":   str(pinkash.get("MISPAR_KABLAN") or "").strip() or None,
            "company_name_he": (pinkash.get("SHEM_YESHUT") or "").strip() or None,
            "kvutza":          kvutza,
            "sivug":           sivug,
            "gov_branch":      (pinkash.get("TEUR_ANAF") or "").strip() or None,
            "email":           (pinkash.get("EMAIL") or "").strip() or None,
            "phone":           (str(pinkash.get("MISPAR_TEL") or "")).strip() or None,
        }

    ica_fields = {}
    if ica:
        ica_fields = {
            "gov_company_status": (ica.get("סטטוס חברה") or "").strip() or None,
            "company_name_he":    (ica.get("שם חברה") or "").strip() or None,
        }

    return {
        "pinkash_found":   bool(row.get("pinkash_found")),
        "ica_found":       bool(row.get("ica_found")),
        "fetched_at":      row["fetched_at"].isoformat() if hasattr(row.get("fetched_at"), "isoformat") else row.get("fetched_at"),
        "pinkash":         pinkash_fields or None,
        "ica":             ica_fields or None,
    }


def _gov_corporation(org_cur, business_number: str) -> Optional[dict]:
    """Row from the admin-uploaded רשות האוכלוסין PDF that matches this
    corp's business_number (most recent year if multiple). Includes the
    source_year and imported_at so the admin can see how fresh the
    match is."""
    if not business_number:
        return None
    org_cur.execute(
        """SELECT source_year, serial_no, company_name_he, address,
                  phone_mobile_1, phone_mobile_2,
                  phone_landline_1, phone_landline_2,
                  imported_at
           FROM gov_corporations_registry
           WHERE business_number = %s
           ORDER BY source_year DESC
           LIMIT 1""",
        (business_number,),
    )
    row = org_cur.fetchone()
    if not row:
        return None
    return _serialize(row)


@router.get("/orgs/{org_id}/summary")
def get_org_summary(
    org_id: str,
    org_type: str = Query("contractor", regex="^(contractor|corporation)$"),
):
    """All-in-one aggregate for the admin org-detail page. One query
    per data source, no extra round-trips from the UI."""
    org_conn = get_db("org_db")
    try:
        org_cur = org_conn.cursor()
        table = "contractors" if org_type == "contractor" else "corporations"
        org_cur.execute(
            f"SELECT * FROM {table} WHERE id = %s AND deleted_at IS NULL",
            (org_id,),
        )
        org = org_cur.fetchone()
        if not org:
            raise HTTPException(status_code=404, detail="Organisation not found")
        org = _serialize(org)
        business_number = org.get("business_number")

        # Gov data — branched by type.
        if org_type == "contractor":
            gov = _gov_contractor(org_cur, business_number)
            gov_payload = {"contractor": gov}
        else:
            gov = _gov_corporation(org_cur, business_number)
            gov_payload = {"corporation": gov}
    finally:
        org_conn.close()

    # Deal counts + recent deals come from deal_db. worker_searches
    # lives in job_db (see migration 024), so open_searches has its
    # own short-lived connection.
    deal_conn = get_db("deal_db")
    try:
        deal_cur = deal_conn.cursor()
        deal_counts = _deal_counts(deal_cur, org_id, org_type)
        recent_deals = _recent_deals(deal_cur, org_id, org_type)
    finally:
        deal_conn.close()

    # Enrich recent_deals' profession + open searches both via job_db
    # (worker_searches) + worker_db (profession_types). One job_conn
    # serves both.
    job_conn = get_db("job_db")
    try:
        worker_conn = get_db("worker_db")
        try:
            _enrich_recent_deals_profession(recent_deals, job_conn, worker_conn)
        finally:
            worker_conn.close()
        open_searches = (
            _open_searches_count(job_conn.cursor(), org_id)
            if org_type == "contractor" else 0
        )
    finally:
        job_conn.close()

    # Other-party name lookup hits org_db; do it after the deal block
    # so the deal_conn can close first.
    org_conn = get_db("org_db")
    try:
        _enrich_recent_deals(recent_deals, org_conn, org_id, org_type)
    finally:
        org_conn.close()

    # Team-member count (active accepted memberships only).
    auth_conn = get_db("auth_db")
    try:
        auth_cur = auth_conn.cursor()
        team_count = _team_member_count(auth_cur, org_id, org_type)
    finally:
        auth_conn.close()

    # Workers count — corp-only.
    workers = None
    if org_type == "corporation":
        worker_conn = get_db("worker_db")
        try:
            worker_cur = worker_conn.cursor()
            workers = _workers_count(worker_cur, org_id)
        finally:
            worker_conn.close()

    # Verification-status block (contractor only) — single source of
    # truth for the admin UI's "is this org actually who they claim
    # to be?" banner. Computes phone/email-match against the
    # captured registry snapshot, so the admin doesn't have to eyeball
    # the columns and figure out whether the contractor self-verified
    # or got manual-approved without proof.
    verification_status = None
    if org_type == "contractor":
        verification_status = _contractor_verification_status(org, gov)

    return {
        "org":                 {**org, "org_type": org_type},
        "deal_counts":         deal_counts,
        "team_count":          team_count,
        "workers":             workers,            # null for contractors
        "open_searches":       open_searches,      # 0 for corps
        "recent_deals":        recent_deals,
        "gov":                 gov_payload,
        "verification_status": verification_status,
    }


def _contractor_verification_status(org: dict, gov: Optional[dict]) -> dict:
    """How strongly the contractor is identity-verified, and which
    channels match the registry.

    The admin UI uses this to render a banner / badge so reviewers see
    at a glance:
      - 'verified'        — kablan-match (phone or email or ח.פ aligned)
      - 'manual'          — admin clicked approve; no automatic proof
      - 'pending'         — never reached tier_2
      - 'unverified'      — tier_2 but via a now-deprecated path (no kablan match recorded)

    Plus per-channel match flags so the UI can highlight which field
    is suspicious. Comparison sources:
      - contractors.contact_phone vs registry_phone (column captured at
        registration) — falls back to the live gov pinkash row when
        the snapshot is empty (old rows).
      - contractors.contact_email vs registry_email (same fallback).
      - contractors.business_number vs the kablan-record MISPAR_YESHUT
        is implicit; if the row was matched on path B (sole prop),
        kablan_verified_at is set and registry_yeshut may be blank.
    """
    method   = (org.get("verification_method") or "").strip()
    tier     = org.get("verification_tier")
    approved = org.get("approval_status") == "approved"

    # Resolve registry phone/email — prefer the snapshot captured at
    # registration (migration 045 columns), fall back to whatever the
    # live gov pinkash cache currently has.
    registry_phone = org.get("registry_phone")
    registry_email = org.get("registry_email")
    if not registry_phone and gov and gov.get("pinkash"):
        registry_phone = gov["pinkash"].get("phone")
    if not registry_email and gov and gov.get("pinkash"):
        registry_email = gov["pinkash"].get("email")

    user_phone = org.get("contact_phone")
    user_email = org.get("contact_email")

    # Canonical compare for phone; case-insensitive for email.
    phone_match: Optional[bool] = None
    if registry_phone and user_phone:
        rp = _canonical_il_phone(registry_phone)
        up = _canonical_il_phone(user_phone)
        phone_match = bool(rp and up and rp == up)
    email_match: Optional[bool] = None
    if registry_email and user_email:
        email_match = registry_email.strip().lower() == user_email.strip().lower()

    # Overall verdict.
    if not approved or tier != "tier_2":
        verdict = "pending"
    elif method == "kablan_match":
        verdict = "verified"
    elif method == "manual":
        verdict = "manual"
    else:
        # tier_2 via 'email' / 'sms' / 'none' — pre-kablan-match era.
        verdict = "unverified" if method in ("none", "") else "legacy"

    return {
        "verdict":         verdict,
        "tier":            tier,
        "method":          method or None,
        "approval_status": org.get("approval_status"),
        "kablan_verified_at":       org.get("kablan_verified_at"),
        "gov_registry_fetched_at":  org.get("gov_registry_fetched_at"),
        "registry_phone":  registry_phone,
        "registry_email":  registry_email,
        "user_phone":      user_phone,
        "user_email":      user_email,
        "phone_match":     phone_match,      # None when comparison impossible
        "email_match":     email_match,
    }
