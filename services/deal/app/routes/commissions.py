from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from decimal import Decimal
from typing import Optional
import uuid

from app.db import get_db
from app.services import audit
from app.publisher import publish_event

router = APIRouter()


class CommissionCreate(BaseModel):
    gross_amount: Decimal
    commission_rate: Decimal
    created_by: str
    notes: Optional[str] = None


@router.post("/{deal_id}", status_code=201)
async def create_commission(deal_id: str, data: CommissionCreate):
    commission_amount = data.gross_amount * data.commission_rate
    commission_id = str(uuid.uuid4())
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO commissions
               (id, deal_id, gross_amount, commission_rate, commission_amount, created_by, notes)
               VALUES (%s,%s,%s,%s,%s,%s,%s)""",
            (commission_id, deal_id, data.gross_amount, data.commission_rate,
             commission_amount, data.created_by, data.notes)
        )
        conn.commit()

        audit.log("commission", commission_id, "created", data.created_by,
                  new_value={"deal_id": deal_id, "amount": str(commission_amount)})

        await publish_event("commission.invoiced", {
            "deal_id": deal_id,
            "commission_id": commission_id,
            "amount": str(commission_amount),
        })

        return {"id": commission_id, "amount": str(commission_amount)}
    finally:
        conn.close()


@router.get("/{deal_id}")
def get_commission(deal_id: str):
    conn = get_db()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT * FROM commissions WHERE deal_id=%s", (deal_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Commission not found")
        return row
    finally:
        conn.close()


@router.patch("/{commission_id}/status")
def update_commission_status(commission_id: str, body: dict):
    new_status = body.get("status")
    if new_status not in ("pending", "invoiced", "paid", "disputed"):
        raise HTTPException(status_code=400, detail="Invalid status")
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE commissions SET status=%s WHERE id=%s", (new_status, commission_id))
        conn.commit()
        return {"id": commission_id, "status": new_status}
    finally:
        conn.close()
