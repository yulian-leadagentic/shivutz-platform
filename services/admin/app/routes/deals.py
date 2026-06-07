"""Admin deal-list endpoint with party-enrichment + stuck-stage computation.

Powers the /admin/deals dashboard the admin uses to scan every deal,
spot the ones stuck waiting on someone, and click straight into the
party contact info to push things along.

The deal service has its own /deals list, but it's role-scoped (only
returns deals the caller owns) and doesn't carry party names. This
admin endpoint:
  * returns ALL deals
  * joins org_db.{contractors,corporations} for company_name_he,
    contact_name, contact_phone, contact_email of both parties
  * pre-computes `stuck_stage` (which side is currently blocking)
    + `hours_in_stage` so the frontend doesn't have to redo the
    SLA math against each deal's timestamp set
"""

from fastapi import APIRouter, Query
from decimal import Decimal
from typing import Optional

from app.db import get_db

router = APIRouter()


def _serialize(row: dict) -> dict:
    """Datetime → ISO string, Decimal → float. Same helper as commissions.py."""
    for k, v in row.items():
        if hasattr(v, "isoformat"):
            row[k] = v.isoformat()
        elif isinstance(v, Decimal):
            row[k] = float(v)
    return row


# Statuses where someone is actively blocked, plus which side is
# blocking. Closed / cancelled / rejected / expired = nobody's stuck.
# The cron-driven `approved` window technically blocks "the system",
# not a human party — surfaced as 'system' so the admin can spot
# the dead-cron case (deals stuck in approved past scheduled_capture).
STUCK_OWNER = {
    "proposed":         "corp",        # corp must respond with worker assignment
    "corp_committed":   "contractor",  # contractor must approve / reject
    "counter_proposed": "contractor",  # same — sitting in contractor's court
    "approved":         "system",      # waiting for auto-capture cron
    "accepted":         "system",      # legacy alias for approved
    "active":           "neither",     # work in progress between parties
    "reporting":        "neither",
    "closed":           "neither",
    "completed":        "neither",
    "cancelled":        "neither",
    "cancelled_by_corp": "neither",
    "cancelled_by_contractor": "neither",
    "rejected":         "neither",
    "expired":          "neither",
    "disputed":         "admin",       # awaiting admin resolution
}

# Which timestamp marks the entry into the current stage. None = no
# meaningful stage-entry timestamp (use created_at as fallback).
STAGE_ENTRY_TS = {
    "proposed":         "created_at",
    "corp_committed":   "corp_committed_at",
    "counter_proposed": "corp_committed_at",
    "approved":         "approved_at",
    "accepted":         "approved_at",
    "disputed":         "updated_at",
}


@router.get("/deals")
def list_deals_for_admin(
    stuck: Optional[str] = Query(None, description="Filter: 'corp' | 'contractor' | 'system' | 'admin' | 'all'"),
    status: Optional[str] = Query(None),
):
    """Every deal in the system, enriched for the admin dashboard."""
    deal_conn = get_db("deal_db")
    org_conn  = get_db("org_db")
    job_conn  = get_db("job_db")
    worker_conn = get_db("worker_db")
    try:
        deal_cur = deal_conn.cursor()
        # Pull deals + enrich profession + region via the search row.
        # Cross-DB joins worked before in deal-service list_deals — admin
        # service runs in the same container network so the same trick
        # is fine here. Worker count is a sub-query so an unattached
        # deal still appears with 0 (rather than getting filtered out
        # by an INNER JOIN).
        deal_cur.execute(
            """SELECT d.*,
                      (SELECT COUNT(*) FROM deal_workers dw
                        WHERE dw.deal_id = d.id
                          AND dw.removed_at IS NULL) AS worker_count
                 FROM deals d
                WHERE d.deleted_at IS NULL
                ORDER BY d.updated_at DESC"""
        )
        deals = [_serialize(r) for r in deal_cur.fetchall()]
        if not deals:
            return {"items": [], "total": 0}

        # ── Enrich with search metadata (profession, region) ────────
        search_ids = list({d["search_id"] for d in deals if d.get("search_id")})
        searches: dict = {}
        if search_ids:
            placeholders = ",".join(["%s"] * len(search_ids))
            job_cur = job_conn.cursor()
            job_cur.execute(
                f"""SELECT id, profession_type, quantity AS requested_count, region
                      FROM worker_searches WHERE id IN ({placeholders})""",
                search_ids,
            )
            for r in job_cur.fetchall():
                searches[r["id"]] = r

            # Pull Hebrew labels for the professions in this set.
            prof_codes = list({s["profession_type"] for s in searches.values() if s.get("profession_type")})
            prof_he: dict = {}
            if prof_codes:
                wp = ",".join(["%s"] * len(prof_codes))
                w_cur = worker_conn.cursor()
                w_cur.execute(
                    f"SELECT code, name_he FROM profession_types WHERE code IN ({wp})",
                    prof_codes,
                )
                for r in w_cur.fetchall():
                    prof_he[r["code"]] = r["name_he"]
            for s in searches.values():
                s["profession_he"] = prof_he.get(s.get("profession_type"), s.get("profession_type"))

        # ── Enrich with party names + contact info ──────────────────
        contractor_ids  = list({d["contractor_id"]  for d in deals if d.get("contractor_id")})
        corporation_ids = list({d["corporation_id"] for d in deals if d.get("corporation_id")})

        contractors: dict = {}
        corporations: dict = {}
        org_cur = org_conn.cursor()
        if contractor_ids:
            ph = ",".join(["%s"] * len(contractor_ids))
            org_cur.execute(
                f"""SELECT id, company_name_he, company_name,
                           contact_name, contact_phone, contact_email
                      FROM contractors WHERE id IN ({ph})""",
                contractor_ids,
            )
            for r in org_cur.fetchall():
                contractors[r["id"]] = r
        if corporation_ids:
            ph = ",".join(["%s"] * len(corporation_ids))
            org_cur.execute(
                f"""SELECT id, company_name_he, company_name,
                           contact_name, contact_phone, contact_email
                      FROM corporations WHERE id IN ({ph})""",
                corporation_ids,
            )
            for r in org_cur.fetchall():
                corporations[r["id"]] = r

        # ── Stitch ──────────────────────────────────────────────────
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        out = []
        for d in deals:
            # Party enrichment — `None` is acceptable so the frontend
            # can render a "—" instead of an 8-char UUID stub.
            cont = contractors.get(d.get("contractor_id"))
            corp = corporations.get(d.get("corporation_id"))
            d["contractor_name"]   = (cont or {}).get("company_name_he") or (cont or {}).get("company_name")
            d["contractor_contact"] = {
                "name":  (cont or {}).get("contact_name"),
                "phone": (cont or {}).get("contact_phone"),
                "email": (cont or {}).get("contact_email"),
            } if cont else None
            d["corporation_name"]   = (corp or {}).get("company_name_he") or (corp or {}).get("company_name")
            d["corporation_contact"] = {
                "name":  (corp or {}).get("contact_name"),
                "phone": (corp or {}).get("contact_phone"),
                "email": (corp or {}).get("contact_email"),
            } if corp else None

            # Search enrichment.
            search = searches.get(d.get("search_id")) if d.get("search_id") else None
            d["profession_type"] = (search or {}).get("profession_type")
            d["profession_he"]   = (search or {}).get("profession_he")
            d["region"]          = (search or {}).get("region")
            d["requested_count"] = (search or {}).get("requested_count")

            # Stuck-stage computation. `stuck_on` tells the admin which
            # party is currently blocking the deal moving forward; the
            # dashboard filter buttons key off this. `hours_in_stage`
            # is how long the deal has been sitting in its current
            # stage — surfaced as the "stuck for X hours" hint.
            status_value = d.get("status") or ""
            d["stuck_on"] = STUCK_OWNER.get(status_value, "unknown")
            entry_field = STAGE_ENTRY_TS.get(status_value, "created_at")
            entry_iso = d.get(entry_field) or d.get("created_at")
            try:
                # Already ISO-serialised by _serialize above.
                if entry_iso and isinstance(entry_iso, str):
                    s = entry_iso
                    # Normalise the MySQL "YYYY-MM-DD HH:MM:SS" no-tz
                    # format to UTC, same trick the frontend uses.
                    if " " in s and "T" not in s:
                        s = s.replace(" ", "T")
                    if not (s.endswith("Z") or "+" in s[-6:] or "-" in s[-6:]):
                        s = s + "+00:00"
                    entry_dt = datetime.fromisoformat(s)
                    delta = now - entry_dt
                    d["hours_in_stage"] = round(delta.total_seconds() / 3600, 1)
                else:
                    d["hours_in_stage"] = None
            except Exception:
                d["hours_in_stage"] = None

            out.append(d)

        # ── Apply filters ───────────────────────────────────────────
        if stuck and stuck != "all":
            out = [d for d in out if d["stuck_on"] == stuck]
        if status:
            out = [d for d in out if d["status"] == status]

        return {"items": out, "total": len(out)}
    finally:
        deal_conn.close()
        org_conn.close()
        job_conn.close()
        worker_conn.close()
