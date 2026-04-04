"""
Deal state machine transitions:
  proposed → counter_proposed → accepted → active → reporting → completed
                                                               → disputed
  Any state → cancelled
"""
from fastapi import HTTPException
from app.db import get_db
from app.services import audit

VALID_TRANSITIONS = {
    "proposed":         {"counter_proposed", "accepted", "cancelled"},
    "counter_proposed": {"accepted", "cancelled"},
    "accepted":         {"active", "cancelled"},
    "active":           {"reporting", "cancelled"},
    "reporting":        {"completed", "disputed"},
    "completed":        set(),
    "disputed":         {"completed", "cancelled"},
    "cancelled":        set(),
}


def transition(deal_id: str, new_status: str, performed_by: str):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM deals WHERE id = %s AND deleted_at IS NULL", (deal_id,))
        deal = cur.fetchone()
        if not deal:
            raise HTTPException(status_code=404, detail="Deal not found")

        current = deal["status"]
        if new_status not in VALID_TRANSITIONS.get(current, set()):
            raise HTTPException(
                status_code=422,
                detail=f"Cannot transition deal from '{current}' to '{new_status}'"
            )

        cur.execute("UPDATE deals SET status = %s WHERE id = %s", (new_status, deal_id))
        conn.commit()

        audit.log("deal", deal_id, "status_changed", performed_by,
                  old_value={"status": current},
                  new_value={"status": new_status})
        return {"id": deal_id, "status": new_status}
    finally:
        conn.close()


def check_discrepancy(deal_id: str):
    """Compare contractor and corporation reports. Flag if mismatched."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT reported_by, actual_workers, actual_days FROM deal_reports WHERE deal_id = %s",
            (deal_id,)
        )
        reports = {r["reported_by"]: r for r in cur.fetchall()}

        if "contractor" not in reports or "corporation" not in reports:
            return  # Both reports not yet submitted

        c_rep = reports["contractor"]
        corp_rep = reports["corporation"]

        workers_match = c_rep["actual_workers"] == corp_rep["actual_workers"]
        days_diff = abs(c_rep["actual_days"] - corp_rep["actual_days"])

        if not workers_match or days_diff > 2:
            details = {
                "contractor_workers": c_rep["actual_workers"],
                "corporation_workers": corp_rep["actual_workers"],
                "contractor_days": c_rep["actual_days"],
                "corporation_days": corp_rep["actual_days"],
            }
            import json
            cur.execute(
                "UPDATE deals SET discrepancy_flag=TRUE, discrepancy_details=%s, status='disputed' WHERE id=%s",
                (json.dumps(details), deal_id)
            )
            conn.commit()
            audit.log("deal", deal_id, "discrepancy_flagged", "system", new_value=details)
            return True
        else:
            cur.execute("UPDATE deals SET status='completed' WHERE id=%s", (deal_id,))
            conn.commit()
            audit.log("deal", deal_id, "status_changed", "system",
                      old_value={"status": "reporting"}, new_value={"status": "completed"})
            return False
    finally:
        conn.close()
