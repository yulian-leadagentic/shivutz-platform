from fastapi import APIRouter
from pydantic import BaseModel
from datetime import date
from typing import Optional
import uuid

from app.db import get_db

router = APIRouter()


class AvailabilityBlock(BaseModel):
    unavailable_from: date
    unavailable_to: date
    reason: Optional[str] = None


@router.post("/{worker_id}/availability", status_code=201)
def add_unavailability(worker_id: str, data: AvailabilityBlock):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO worker_availability (id, worker_id, unavailable_from, unavailable_to, reason) VALUES (%s,%s,%s,%s,%s)",
            (str(uuid.uuid4()), worker_id, data.unavailable_from, data.unavailable_to, data.reason)
        )
        conn.commit()
        return {"message": "availability block added"}
    finally:
        conn.close()


@router.get("/{worker_id}/availability")
def get_availability(worker_id: str):
    conn = get_db()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute(
            "SELECT * FROM worker_availability WHERE worker_id = %s ORDER BY unavailable_from",
            (worker_id,)
        )
        return cur.fetchall()
    finally:
        conn.close()
