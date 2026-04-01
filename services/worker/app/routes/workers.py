from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import List, Optional
from datetime import date
import uuid, json

from app.db import get_db

router = APIRouter()


class WorkerCreate(BaseModel):
    corporation_id: str
    first_name: str
    last_name: str
    profession_type: str
    experience_years: int = 0
    origin_country: str
    languages: List[str] = []
    visa_type: Optional[str] = None
    visa_number: Optional[str] = None
    visa_valid_from: Optional[date] = None
    visa_valid_until: Optional[date] = None
    notes: Optional[str] = None
    extra_fields: Optional[dict] = None


class WorkerUpdate(BaseModel):
    profession_type: Optional[str] = None
    experience_years: Optional[int] = None
    languages: Optional[List[str]] = None
    visa_valid_until: Optional[date] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    extra_fields: Optional[dict] = None


@router.post("", status_code=201)
def create_worker(data: WorkerCreate):
    worker_id = str(uuid.uuid4())
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO workers
               (id, corporation_id, first_name, last_name, profession_type,
                experience_years, origin_country, languages, visa_type, visa_number,
                visa_valid_from, visa_valid_until, notes, extra_fields)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (worker_id, data.corporation_id, data.first_name, data.last_name,
             data.profession_type, data.experience_years, data.origin_country,
             json.dumps(data.languages), data.visa_type, data.visa_number,
             data.visa_valid_from, data.visa_valid_until, data.notes,
             json.dumps(data.extra_fields) if data.extra_fields else None)
        )
        conn.commit()
        return {"id": worker_id}
    finally:
        conn.close()


@router.get("")
def list_workers(
    corporation_id: Optional[str] = None,
    profession: Optional[str] = Query(None, alias="profession"),
    status: Optional[str] = None,
    visa_until_min: Optional[date] = None,
    limit: int = 100,
):
    conn = get_db()
    try:
        cur = conn.cursor()
        filters = ["deleted_at IS NULL"]
        params = []

        if corporation_id:
            filters.append("corporation_id = %s"); params.append(corporation_id)
        if profession:
            filters.append("profession_type = %s"); params.append(profession)
        if status:
            filters.append("status = %s"); params.append(status)
        if visa_until_min:
            filters.append("visa_valid_until >= %s"); params.append(visa_until_min)

        where = " AND ".join(filters)
        cur.execute(f"SELECT * FROM workers WHERE {where} ORDER BY experience_years DESC LIMIT %s",
                    params + [limit])
        return cur.fetchall()
    finally:
        conn.close()


@router.get("/{worker_id}")
def get_worker(worker_id: str):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM workers WHERE id = %s AND deleted_at IS NULL", (worker_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Worker not found")
        return row
    finally:
        conn.close()


@router.patch("/{worker_id}")
def update_worker(worker_id: str, data: WorkerUpdate):
    conn = get_db()
    try:
        cur = conn.cursor()
        updates, params = [], []
        if data.profession_type  is not None: updates.append("profession_type=%s");  params.append(data.profession_type)
        if data.experience_years is not None: updates.append("experience_years=%s"); params.append(data.experience_years)
        if data.languages        is not None: updates.append("languages=%s");        params.append(json.dumps(data.languages))
        if data.visa_valid_until is not None: updates.append("visa_valid_until=%s"); params.append(data.visa_valid_until)
        if data.status           is not None: updates.append("status=%s");           params.append(data.status)
        if data.notes            is not None: updates.append("notes=%s");            params.append(data.notes)
        if data.extra_fields     is not None: updates.append("extra_fields=%s");     params.append(json.dumps(data.extra_fields))
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")
        params.append(worker_id)
        cur.execute(f"UPDATE workers SET {', '.join(updates)} WHERE id = %s AND deleted_at IS NULL", params)
        conn.commit()
        return {"id": worker_id, "updated": True}
    finally:
        conn.close()


@router.delete("/{worker_id}", status_code=204)
def delete_worker(worker_id: str):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE workers SET deleted_at = NOW() WHERE id = %s", (worker_id,))
        conn.commit()
    finally:
        conn.close()
