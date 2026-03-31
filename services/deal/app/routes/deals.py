from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from decimal import Decimal
import uuid, json

from app.db import get_db
from app.services import audit
from app.publisher import publish_event

router = APIRouter()


class DealCreate(BaseModel):
    request_line_item_id: str
    contractor_id: str
    corporation_id: str
    proposed_by: str
    workers_count: int
    worker_ids: List[str]
    agreed_price: Optional[Decimal] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    notes: Optional[str] = None


@router.post("", status_code=201)
async def create_deal(data: DealCreate):
    deal_id = str(uuid.uuid4())
    conn = get_db()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute(
            """INSERT INTO deals
               (id, request_line_item_id, contractor_id, corporation_id, proposed_by,
                workers_count, agreed_price, start_date, end_date, notes)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (deal_id, data.request_line_item_id, data.contractor_id, data.corporation_id,
             data.proposed_by, data.workers_count, data.agreed_price,
             data.start_date, data.end_date, data.notes)
        )

        for worker_id in data.worker_ids:
            cur.execute(
                "INSERT INTO deal_workers (id, deal_id, worker_id) VALUES (%s,%s,%s)",
                (str(uuid.uuid4()), deal_id, worker_id)
            )

        conn.commit()

        audit.log("deal", deal_id, "created", data.proposed_by,
                  new_value={"contractor_id": data.contractor_id, "corporation_id": data.corporation_id})

        await publish_event("deal.proposed", {
            "deal_id": deal_id,
            "contractor_id": data.contractor_id,
            "corporation_id": data.corporation_id,
        })

        return {"id": deal_id, "status": "proposed"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@router.get("/{deal_id}")
def get_deal(deal_id: str):
    conn = get_db()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT * FROM deals WHERE id = %s AND deleted_at IS NULL", (deal_id,))
        deal = cur.fetchone()
        if not deal:
            raise HTTPException(status_code=404, detail="Deal not found")
        return deal
    finally:
        conn.close()


@router.patch("/{deal_id}/status")
async def update_status(deal_id: str, body: dict):
    from app.services.deal_lifecycle import transition
    new_status = body.get("status")
    performed_by = body.get("performed_by", "unknown")
    result = transition(deal_id, new_status, performed_by)

    # Notify on key transitions
    if new_status in ("accepted", "cancelled", "completed", "disputed"):
        await publish_event(f"deal.{new_status}", {"deal_id": deal_id})

    return result


@router.get("/contractors/{contractor_id}/deals")
def list_contractor_deals(contractor_id: str):
    conn = get_db()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute(
            "SELECT * FROM deals WHERE contractor_id=%s AND deleted_at IS NULL ORDER BY created_at DESC",
            (contractor_id,)
        )
        return cur.fetchall()
    finally:
        conn.close()


@router.get("/corporations/{corporation_id}/deals")
def list_corporation_deals(corporation_id: str):
    conn = get_db()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute(
            "SELECT * FROM deals WHERE corporation_id=%s AND deleted_at IS NULL ORDER BY created_at DESC",
            (corporation_id,)
        )
        return cur.fetchall()
    finally:
        conn.close()
