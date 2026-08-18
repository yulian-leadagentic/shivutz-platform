"""Admin dashboard — pivot/v2 snapshot.

Historically this router exposed a legacy /dashboard that summed deal
queues + worker/search demand across the now-dropped deal_db and job_db.
Those tables no longer exist. The single supported endpoint is
/dashboard/pivot-stats.
"""
from datetime import datetime

from fastapi import APIRouter

from app.db import get_db

router = APIRouter()


def _serialize(row: dict) -> dict:
    for k, v in list(row.items()):
        if hasattr(v, "isoformat"):
            row[k] = v.isoformat()
        elif hasattr(v, "as_tuple"):
            row[k] = float(v)
    return row


@router.get("/dashboard/pivot-stats")
def get_pivot_stats():
    """Pivot/v2 dashboard — deal-free platform-health snapshot."""
    org_conn     = get_db("org_db")
    payment_conn = get_db("payment_db")
    try:
        org_cur = org_conn.cursor()
        pay_cur = payment_conn.cursor()

        org_cur.execute("SELECT COUNT(*) AS n FROM corporations WHERE approval_status='approved' AND deleted_at IS NULL")
        active_corps = int(org_cur.fetchone()["n"])
        org_cur.execute("SELECT COUNT(*) AS n FROM contractors  WHERE approval_status='approved' AND deleted_at IS NULL")
        active_contractors = int(org_cur.fetchone()["n"])

        org_cur.execute("""SELECT ad_type, COUNT(*) AS n
                             FROM ads
                            WHERE active=TRUE AND deleted_at IS NULL
                              AND (expires_at IS NULL OR expires_at > NOW())
                            GROUP BY ad_type""")
        ads_by_type = {r["ad_type"]: int(r["n"]) for r in org_cur.fetchall()}

        pay_cur.execute("""SELECT COUNT(*) AS n FROM subscriptions
                            WHERE status='trialing'
                              AND trial_ends_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 7 DAY)""")
        trials_expiring_7d = int(pay_cur.fetchone()["n"])

        # Compute start-of-month with an all-integer expression so the
        # SQL carries no % at all. Both format-string forms are fragile:
        #   '%Y-%m-01'  — 500s when execute() gets args (pymysql runs
        #                 `query % args` and %Y looks like a placeholder)
        #   '%%Y-%%m-01' — silently wrong when execute() gets NO args
        #                 (pymysql skips interpolation, MySQL DATE_FORMAT
        #                 reads %% as a literal %, the format string
        #                 becomes '%Y-%m-01', coerces to 0000-00-00, and
        #                 the comparison matches every row → the admin
        #                 dashboard was counting reveals all the way back
        #                 instead of this month).
        # DATE_SUB(CURDATE(), INTERVAL DAYOFMONTH(CURDATE())-1 DAY)
        # yields today's date with the day-of-month rewound to 1 — the
        # first midnight of the current month. Works identically whether
        # execute() has args or not. Same expression applied at the two
        # sites in services/user-org/app/routes/ads.py for consistency.
        org_cur.execute("""SELECT COUNT(*) AS n FROM contact_reveals
                            WHERE revealed_at >= DATE_SUB(CURDATE(), INTERVAL DAYOFMONTH(CURDATE())-1 DAY)""")
        reveals_this_month = int(org_cur.fetchone()["n"])

        org_cur.execute("""SELECT SUM(pending) AS total FROM (
                              SELECT COUNT(*) AS pending FROM contractors  WHERE approval_status='pending' AND deleted_at IS NULL
                              UNION ALL
                              SELECT COUNT(*) AS pending FROM corporations WHERE approval_status='pending' AND deleted_at IS NULL
                            ) AS q""")
        pending_approvals = int(org_cur.fetchone()["total"] or 0)

        pay_cur.execute("SELECT tier, COUNT(*) AS n FROM subscriptions WHERE status IN ('trialing','active') GROUP BY tier")
        subs_by_tier = {r["tier"]: int(r["n"]) for r in pay_cur.fetchall()}

        return {
            "active_corps":        active_corps,
            "active_contractors":  active_contractors,
            "ads": {
                "worker":  ads_by_type.get("worker",  0),
                "housing": ads_by_type.get("housing", 0),
                "total":   sum(ads_by_type.values()),
            },
            "trials_expiring_7d":  trials_expiring_7d,
            "reveals_this_month":  reveals_this_month,
            "pending_approvals":   pending_approvals,
            "subs_by_tier":        subs_by_tier,
            "as_of":               datetime.utcnow().isoformat() + "Z",
        }
    finally:
        org_conn.close()
        payment_conn.close()


@router.get("/alerts")
def get_alerts():
    """Approval-SLA warnings for the pending contractor/corp queue.

    Pivot/v2: discrepancy alerts were removed with the deal model, so
    the response keeps that key as an empty list for callers that still
    read it.
    """
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
