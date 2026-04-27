"""Admin dashboard — system snapshot for the operations view.

Single endpoint returns everything the dashboard needs in one round trip:
counts, demand vs supply per profession, deal queues ("who's waiting for
whom"), and the small set of legacy KPIs the existing UI still consumes.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter

from app.db import get_db

router = APIRouter()


def _serialize(row: dict) -> dict:
    for k, v in list(row.items()):
        if hasattr(v, "isoformat"):
            row[k] = v.isoformat()
        elif hasattr(v, "as_tuple"):  # Decimal
            row[k] = float(v)
    return row


def _orgs_by_status(cur, table: str) -> dict:
    cur.execute(
        f"SELECT approval_status, COUNT(*) AS n FROM {table} "
        f"WHERE deleted_at IS NULL GROUP BY approval_status"
    )
    out = {"approved": 0, "pending": 0, "rejected": 0, "suspended": 0, "total": 0}
    for r in cur.fetchall():
        out[r["approval_status"]] = int(r["n"])
        out["total"] += int(r["n"])
    return out


def _workers_by_status(cur) -> dict:
    cur.execute(
        "SELECT status, COUNT(*) AS n FROM workers WHERE deleted_at IS NULL GROUP BY status"
    )
    out = {"available": 0, "assigned": 0, "on_leave": 0, "deactivated": 0, "total": 0}
    for r in cur.fetchall():
        out[r["status"]] = int(r["n"])
        out["total"] += int(r["n"])
    return out


def _workers_per_profession(worker_cur, prof_cur) -> list:
    """Workers grouped by profession_type → counts of total / available / assigned."""
    worker_cur.execute(
        """SELECT profession_type,
                  COUNT(*) AS total,
                  SUM(status='available') AS available,
                  SUM(status='assigned')  AS assigned
           FROM workers
           WHERE deleted_at IS NULL
           GROUP BY profession_type"""
    )
    rows = worker_cur.fetchall()
    if not rows:
        return []

    prof_codes = [r["profession_type"] for r in rows if r["profession_type"]]
    he_map = {}
    if prof_codes:
        ph = ",".join(["%s"] * len(prof_codes))
        prof_cur.execute(f"SELECT code, name_he FROM profession_types WHERE code IN ({ph})", tuple(prof_codes))
        he_map = {r["code"]: r["name_he"] for r in prof_cur.fetchall()}

    return [
        {
            "code":      r["profession_type"],
            "name_he":   he_map.get(r["profession_type"], r["profession_type"]),
            "total":     int(r["total"] or 0),
            "available": int(r["available"] or 0),
            "assigned":  int(r["assigned"] or 0),
        }
        for r in rows
    ]


def _demand_per_profession(job_cur, prof_cur) -> list:
    """Sum of open line-item quantities by profession_type — the demand backlog."""
    job_cur.execute(
        """SELECT li.profession_type,
                  SUM(li.quantity) AS demand_qty,
                  COUNT(DISTINCT jr.id) AS open_requests
           FROM job_request_line_items li
           JOIN job_requests jr ON jr.id = li.request_id
           WHERE jr.deleted_at IS NULL
             AND COALESCE(jr.status, 'open') IN ('open', 'matching')
           GROUP BY li.profession_type"""
    )
    rows = job_cur.fetchall()
    if not rows:
        return []
    prof_codes = [r["profession_type"] for r in rows if r["profession_type"]]
    he_map = {}
    if prof_codes:
        ph = ",".join(["%s"] * len(prof_codes))
        prof_cur.execute(f"SELECT code, name_he FROM profession_types WHERE code IN ({ph})", tuple(prof_codes))
        he_map = {r["code"]: r["name_he"] for r in prof_cur.fetchall()}
    return [
        {
            "code":          r["profession_type"],
            "name_he":       he_map.get(r["profession_type"], r["profession_type"]),
            "demand_qty":    int(r["demand_qty"] or 0),
            "open_requests": int(r["open_requests"] or 0),
        }
        for r in rows
    ]


def _deal_queues(cur) -> dict:
    """The 'who's waiting for whom' queues."""
    cur.execute(
        """SELECT status, COUNT(*) AS n
           FROM deals WHERE deleted_at IS NULL GROUP BY status"""
    )
    by_status = {r["status"]: int(r["n"]) for r in cur.fetchall()}

    # Detail rows for the two waiting queues. Cap at 50 to keep the payload light.
    cur.execute(
        """SELECT d.id, d.contractor_id, d.corporation_id, d.commission_amount,
                  d.corp_committed_at, d.expires_at,
                  TIMESTAMPDIFF(HOUR, d.corp_committed_at, NOW()) AS hours_waiting,
                  (SELECT COUNT(*) FROM deal_workers dw WHERE dw.deal_id=d.id) AS worker_count
           FROM deals d
           WHERE d.status='corp_committed' AND d.deleted_at IS NULL
           ORDER BY d.corp_committed_at ASC LIMIT 50"""
    )
    waiting_for_contractor = [_serialize(r) for r in cur.fetchall()]

    cur.execute(
        """SELECT d.id, d.contractor_id, d.corporation_id, d.commission_amount,
                  d.approved_at, d.scheduled_capture_at,
                  TIMESTAMPDIFF(HOUR, NOW(), d.scheduled_capture_at) AS hours_until_capture,
                  (SELECT COUNT(*) FROM deal_workers dw WHERE dw.deal_id=d.id) AS worker_count
           FROM deals d
           WHERE d.status='approved' AND d.deleted_at IS NULL
           ORDER BY d.scheduled_capture_at ASC LIMIT 50"""
    )
    waiting_for_capture = [_serialize(r) for r in cur.fetchall()]

    return {
        "by_status":              by_status,
        "waiting_for_contractor": waiting_for_contractor,
        "waiting_for_capture":    waiting_for_capture,
    }


@router.get("/dashboard")
def get_dashboard():
    org_conn    = get_db("org_db")
    worker_conn = get_db("worker_db")
    job_conn    = get_db("job_db")
    deal_conn   = get_db("deal_db")
    try:
        org_cur    = org_conn.cursor()
        worker_cur = worker_conn.cursor()
        job_cur    = job_conn.cursor()
        deal_cur   = deal_conn.cursor()

        contractors = _orgs_by_status(org_cur, "contractors")
        corporations = _orgs_by_status(org_cur, "corporations")
        workers = _workers_by_status(worker_cur)
        # profession_types lives in worker_db, not org_db.
        workers_by_prof = _workers_per_profession(worker_cur, worker_cur)
        demand_by_prof  = _demand_per_profession(job_cur, worker_cur)

        # Workers without any active demand (no open line item for their profession).
        demand_codes = {p["code"] for p in demand_by_prof if p["code"]}
        idle_workers = [
            p for p in workers_by_prof
            if p["available"] > 0 and p["code"] not in demand_codes
        ]

        deal_queues = _deal_queues(deal_cur)

        # Legacy KPI shape kept so the dashboard widgets that haven't been
        # rewritten yet don't break.
        legacy = {
            "pending_approvals":     contractors["pending"] + corporations["pending"],
            "pending_contractors":   contractors["pending"],
            "pending_corporations":  corporations["pending"],
            "open_job_requests":     sum(p["open_requests"] for p in demand_by_prof),
            "active_deals":          sum(n for s, n in deal_queues["by_status"].items() if s in (
                "proposed", "corp_committed", "approved")),
            "discrepancy_alerts":    0,  # discrepancy flag removed in migration 014
            "completed_deals":       deal_queues["by_status"].get("closed", 0),
        }

        return {
            **legacy,
            "contractors":    contractors,
            "corporations":   corporations,
            "workers":        workers,
            "workers_by_profession": workers_by_prof,
            "demand_by_profession":  demand_by_prof,
            "idle_professions":      idle_workers,
            "deal_queues":           deal_queues,
            "as_of":                 datetime.utcnow().isoformat() + "Z",
        }
    finally:
        org_conn.close()
        worker_conn.close()
        job_conn.close()
        deal_conn.close()


@router.get("/alerts")
def get_alerts():
    """SLA warnings only — discrepancies were removed from the deal model."""
    org_conn = get_db("org_db")
    try:
        org_cur = org_conn.cursor()
        org_cur.execute(
            """SELECT id, company_name, contact_email, approval_sla_deadline, 'contractor' AS org_type
               FROM contractors
               WHERE approval_status='pending'
                 AND approval_sla_deadline < DATE_ADD(NOW(), INTERVAL 8 HOUR)
                 AND deleted_at IS NULL
               UNION ALL
               SELECT id, company_name, contact_email, approval_sla_deadline, 'corporation' AS org_type
               FROM corporations
               WHERE approval_status='pending'
                 AND approval_sla_deadline < DATE_ADD(NOW(), INTERVAL 8 HOUR)
                 AND deleted_at IS NULL"""
        )
        sla_warnings = [_serialize(r) for r in org_cur.fetchall()]
        return {"discrepancy_alerts": [], "sla_warnings": sla_warnings}
    finally:
        org_conn.close()
