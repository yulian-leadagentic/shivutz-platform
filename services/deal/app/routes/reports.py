from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from datetime import date
import uuid

from app.db import get_db
from app.services.deal_lifecycle import check_discrepancy
from app.publisher import publish_event

router = APIRouter()


class ReportSubmit(BaseModel):
    reporter_user_id: str
    actual_workers: int
    actual_start_date: date
    actual_end_date: date
    actual_days: int
    notes: str = ""


@router.post("/{deal_id}/reports/{party}")
async def submit_report(deal_id: str, party: str, data: ReportSubmit):
    if party not in ("contractor", "corporation"):
        raise HTTPException(status_code=400, detail="party must be 'contractor' or 'corporation'")

    conn = get_db()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT id, status FROM deals WHERE id=%s AND deleted_at IS NULL", (deal_id,))
        deal = cur.fetchone()
        if not deal:
            raise HTTPException(status_code=404, detail="Deal not found")
        if deal["status"] not in ("active", "reporting"):
            raise HTTPException(status_code=422, detail="Deal is not in a reportable state")

        # Move to 'reporting' if first report
        if deal["status"] == "active":
            cur.execute("UPDATE deals SET status='reporting' WHERE id=%s", (deal_id,))

        cur.execute(
            """INSERT INTO deal_reports
               (id, deal_id, reported_by, reporter_user_id, actual_workers,
                actual_start_date, actual_end_date, actual_days, notes)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON DUPLICATE KEY UPDATE
                 actual_workers=%s, actual_start_date=%s, actual_end_date=%s,
                 actual_days=%s, notes=%s, submitted_at=NOW()""",
            (str(uuid.uuid4()), deal_id, party, data.reporter_user_id,
             data.actual_workers, data.actual_start_date, data.actual_end_date,
             data.actual_days, data.notes,
             data.actual_workers, data.actual_start_date, data.actual_end_date,
             data.actual_days, data.notes)
        )

        # Mark report submitted
        col = "contractor_report_submitted" if party == "contractor" else "corporation_report_submitted"
        cur.execute(f"UPDATE deals SET {col}=TRUE WHERE id=%s", (deal_id,))
        conn.commit()

    finally:
        conn.close()

    # After both reports submitted, check discrepancy
    is_discrepancy = check_discrepancy(deal_id)
    if is_discrepancy:
        await publish_event("deal.discrepancy.flagged", {"deal_id": deal_id})

    return {"deal_id": deal_id, "party": party, "status": "submitted"}
