from fastapi import APIRouter
from app.db import get_db

router = APIRouter()


@router.get("/dashboard")
def get_dashboard():
    """Aggregated KPIs for admin dashboard."""
    org_conn  = get_db("org_db")
    job_conn  = get_db("job_db")
    deal_conn = get_db("deal_db")

    try:
        org_cur  = org_conn.cursor()
        job_cur  = job_conn.cursor()
        deal_cur = deal_conn.cursor()

        org_cur.execute("SELECT COUNT(*) AS total FROM contractors WHERE approval_status='pending' AND deleted_at IS NULL")
        pending_contractors = org_cur.fetchone()["total"]

        org_cur.execute("SELECT COUNT(*) AS total FROM corporations WHERE approval_status='pending' AND deleted_at IS NULL")
        pending_corporations = org_cur.fetchone()["total"]

        job_cur.execute("SELECT COUNT(*) AS total FROM job_requests WHERE status='open' AND deleted_at IS NULL")
        open_requests = job_cur.fetchone()["total"]

        deal_cur.execute("SELECT COUNT(*) AS total FROM deals WHERE status NOT IN ('completed','cancelled') AND deleted_at IS NULL")
        active_deals = deal_cur.fetchone()["total"]

        deal_cur.execute("SELECT COUNT(*) AS total FROM deals WHERE discrepancy_flag=TRUE AND status='disputed'")
        discrepancies = deal_cur.fetchone()["total"]

        deal_cur.execute("SELECT COUNT(*) AS total FROM deals WHERE status='completed'")
        completed_deals = deal_cur.fetchone()["total"]

        return {
            "pending_approvals": pending_contractors + pending_corporations,
            "pending_contractors": pending_contractors,
            "pending_corporations": pending_corporations,
            "open_job_requests": open_requests,
            "active_deals": active_deals,
            "discrepancy_alerts": discrepancies,
            "completed_deals": completed_deals,
        }
    finally:
        org_conn.close()
        job_conn.close()
        deal_conn.close()


@router.get("/alerts")
def get_alerts():
    deal_conn = get_db("deal_db")
    org_conn  = get_db("org_db")
    try:
        deal_cur = deal_conn.cursor()
        org_cur  = org_conn.cursor()

        deal_cur.execute(
            "SELECT id, contractor_id, corporation_id, discrepancy_details, updated_at FROM deals WHERE discrepancy_flag=TRUE AND status='disputed'"
        )
        discrepancies = deal_cur.fetchall()

        org_cur.execute(
            "SELECT id, company_name, contact_email, approval_sla_deadline, 'contractor' AS org_type FROM contractors "
            "WHERE approval_status='pending' AND approval_sla_deadline < DATE_ADD(NOW(), INTERVAL 8 HOUR) AND deleted_at IS NULL "
            "UNION ALL "
            "SELECT id, company_name, contact_email, approval_sla_deadline, 'corporation' AS org_type FROM corporations "
            "WHERE approval_status='pending' AND approval_sla_deadline < DATE_ADD(NOW(), INTERVAL 8 HOUR) AND deleted_at IS NULL"
        )
        sla_warnings = org_cur.fetchall()

        return {
            "discrepancy_alerts": discrepancies,
            "sla_warnings": sla_warnings,
        }
    finally:
        deal_conn.close()
        org_conn.close()
