from fastapi import APIRouter, HTTPException, Header, Query
from pydantic import BaseModel
from typing import List, Optional
from decimal import Decimal
import uuid, os
import httpx

from app.db import get_db
from app.services import audit
from app.publisher import publish_event

router = APIRouter()

JOB_MATCH_URL = os.getenv("JOB_MATCH_SERVICE_URL", "http://job-match:3004")


class DealCreate(BaseModel):
    job_request_id: Optional[str] = None
    request_line_item_id: Optional[str] = None
    contractor_id: Optional[str] = None
    corporation_id: str
    proposed_by: Optional[str] = None
    workers_count: int
    worker_ids: List[str]
    agreed_price: Optional[Decimal] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    notes: Optional[str] = None


@router.get("")
def list_deals(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    x_org_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """List deals visible to the caller. Paginated envelope."""
    offset = (page - 1) * page_size
    empty = {"items": [], "page": page, "page_size": page_size, "total": 0}

    conn = get_db()
    try:
        cur = conn.cursor()
        if x_user_role == "admin":
            where, params = "WHERE deleted_at IS NULL", ()
        elif x_user_role == "corporation" and x_org_id:
            where, params = "WHERE corporation_id=%s AND deleted_at IS NULL", (x_org_id,)
        elif x_org_id:
            where, params = "WHERE contractor_id=%s AND deleted_at IS NULL", (x_org_id,)
        else:
            return empty

        cur.execute(f"SELECT COUNT(*) AS c FROM deals {where}", params)
        total = int(cur.fetchone()["c"])

        cur.execute(
            f"SELECT * FROM deals {where} ORDER BY created_at DESC LIMIT %s OFFSET %s",
            params + (page_size, offset),
        )
        rows = cur.fetchall()
        for row in rows:
            if row.get("agreed_price") is not None:
                row["agreed_price"] = float(row["agreed_price"])
        return {"items": rows, "page": page, "page_size": page_size, "total": total}
    finally:
        conn.close()


@router.post("", status_code=201)
async def create_deal(
    data: DealCreate,
    x_org_id: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None),
):
    contractor_id = data.contractor_id or x_org_id
    proposed_by = data.proposed_by or x_user_id or "unknown"

    # Resolve line_item_id — call job-match service if only job_request_id provided
    line_item_id = data.request_line_item_id
    if not line_item_id and data.job_request_id:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(f"{JOB_MATCH_URL}/job-requests/{data.job_request_id}")
                if resp.status_code == 200:
                    jr = resp.json()
                    items = jr.get("line_items", [])
                    if items:
                        line_item_id = items[0]["id"]
        except Exception:
            pass  # proceed without line_item_id

    deal_id = str(uuid.uuid4())
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO deals
               (id, request_line_item_id, contractor_id, corporation_id, proposed_by,
                workers_count, agreed_price, start_date, end_date, notes)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (deal_id, line_item_id, contractor_id, data.corporation_id,
             proposed_by, data.workers_count, data.agreed_price,
             data.start_date, data.end_date, data.notes)
        )
        for worker_id in data.worker_ids:
            cur.execute(
                "INSERT INTO deal_workers (id, deal_id, worker_id) VALUES (%s,%s,%s)",
                (str(uuid.uuid4()), deal_id, worker_id)
            )
        conn.commit()

        audit.log("deal", deal_id, "created", proposed_by,
                  new_value={"contractor_id": contractor_id, "corporation_id": data.corporation_id})

        await publish_event("deal.proposed", {
            "deal_id": deal_id,
            "contractor_id": contractor_id,
            "corporation_id": data.corporation_id,
        })

        return {"id": deal_id, "status": "proposed"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@router.get("/{deal_id}/workers")
def get_deal_workers(deal_id: str):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT worker_id as id, assigned_at FROM deal_workers WHERE deal_id=%s AND removed_at IS NULL",
            (deal_id,)
        )
        return cur.fetchall()
    finally:
        conn.close()


class WorkersUpdate(BaseModel):
    worker_ids: List[str]


@router.put("/{deal_id}/workers")
def update_deal_workers(
    deal_id: str,
    body: WorkersUpdate,
    x_user_id: Optional[str] = Header(default=None),
):
    """Corporation replaces the worker assignment on a deal."""
    worker_ids = body.worker_ids
    if not worker_ids:
        raise HTTPException(status_code=400, detail="worker_ids required")

    performed_by = x_user_id or "unknown"
    conn = get_db()
    try:
        cur = conn.cursor()
        # Hard-delete existing assignments (UNIQUE KEY prevents re-insert otherwise)
        cur.execute(
            "DELETE FROM deal_workers WHERE deal_id=%s",
            (deal_id,)
        )
        # Insert final selection
        for wid in worker_ids:
            cur.execute(
                "INSERT INTO deal_workers (id, deal_id, worker_id) VALUES (%s,%s,%s)",
                (str(uuid.uuid4()), deal_id, wid)
            )
        conn.commit()
        audit.log("deal", deal_id, "workers_updated", performed_by,
                  new_value={"worker_ids": worker_ids})
        return {"deal_id": deal_id, "assigned": len(worker_ids)}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@router.get("/{deal_id}")
def get_deal(deal_id: str):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM deals WHERE id = %s AND deleted_at IS NULL", (deal_id,))
        deal = cur.fetchone()
        if not deal:
            raise HTTPException(status_code=404, detail="Deal not found")
        if deal.get("agreed_price") is not None:
            deal["agreed_price"] = float(deal["agreed_price"])
        return deal
    finally:
        conn.close()


@router.patch("/{deal_id}/status")
async def update_status(deal_id: str, body: dict):
    from app.services.deal_lifecycle import transition
    new_status = body.get("status")
    performed_by = body.get("performed_by", "unknown")
    result = transition(deal_id, new_status, performed_by)
    if new_status in ("accepted", "cancelled", "completed", "disputed"):
        await publish_event(f"deal.{new_status}", {"deal_id": deal_id})
    return result


@router.get("/contractors/{contractor_id}/deals")
def list_contractor_deals(contractor_id: str):
    conn = get_db()
    try:
        cur = conn.cursor()
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
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM deals WHERE corporation_id=%s AND deleted_at IS NULL ORDER BY created_at DESC",
            (corporation_id,)
        )
        return cur.fetchall()
    finally:
        conn.close()
