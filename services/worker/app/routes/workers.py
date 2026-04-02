from fastapi import APIRouter, HTTPException, Header, Query
from pydantic import BaseModel
from typing import List, Optional
from datetime import date
import uuid, json

from app.db import get_db

router = APIRouter()

# ── Experience range helpers ──────────────────────────────────────────────

EXP_RANGE_TO_YEARS = {
    "1-3": 1,
    "3-5": 3,
    "5+":  5,
}

def exp_range(years: int) -> str:
    if years >= 5: return "5+"
    if years >= 3: return "3-5"
    return "1-3"


# ── Models ────────────────────────────────────────────────────────────────

class WorkerCreate(BaseModel):
    corporation_id: Optional[str] = None   # falls back to x-org-id header
    first_name: str
    last_name: str
    profession_type: str
    experience_years: int = 0
    experience_range: Optional[str] = None  # "1-3" | "3-5" | "5+"
    origin_country: str
    languages: List[str] = []
    visa_type: Optional[str] = None
    visa_number: Optional[str] = None
    visa_valid_from: Optional[date] = None
    visa_valid_until: Optional[date] = None
    available_region: Optional[str] = None   # stored in extra_fields
    available_from: Optional[str] = None     # stored in extra_fields
    notes: Optional[str] = None
    extra_fields: Optional[dict] = None


class WorkerBulkCreate(BaseModel):
    """Create N identical workers differing only by sequential index."""
    quantity: int                            # 1-50
    corporation_id: Optional[str] = None
    name_prefix: Optional[str] = None       # e.g. "עובד" → "עובד 1", "עובד 2"
    profession_type: str
    experience_years: int = 0
    experience_range: Optional[str] = None
    origin_country: str
    languages: List[str] = []
    visa_valid_until: Optional[date] = None
    available_region: Optional[str] = None
    available_from: Optional[str] = None
    notes: Optional[str] = None


class WorkerUpdate(BaseModel):
    profession_type: Optional[str] = None
    experience_years: Optional[int] = None
    experience_range: Optional[str] = None
    languages: Optional[List[str]] = None
    visa_valid_until: Optional[date] = None
    status: Optional[str] = None
    available_region: Optional[str] = None
    available_from: Optional[str] = None
    notes: Optional[str] = None
    extra_fields: Optional[dict] = None


# ── Helpers ───────────────────────────────────────────────────────────────

def _resolve_exp(years: int, range_str: Optional[str]) -> int:
    if range_str and range_str in EXP_RANGE_TO_YEARS:
        return EXP_RANGE_TO_YEARS[range_str]
    return years

def _build_extra(base: Optional[dict], available_region: Optional[str], available_from: Optional[str]) -> Optional[str]:
    extra = dict(base or {})
    if available_region: extra["available_region"] = available_region
    if available_from:   extra["available_from"]   = available_from
    return json.dumps(extra) if extra else None


# ── Routes ────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
def create_worker(
    data: WorkerCreate,
    x_org_id: Optional[str] = Header(default=None),
):
    corp_id = data.corporation_id or x_org_id
    if not corp_id:
        raise HTTPException(status_code=400, detail="corporation_id required")

    exp_years = _resolve_exp(data.experience_years, data.experience_range)
    worker_id = str(uuid.uuid4())
    extra = _build_extra(data.extra_fields, data.available_region, data.available_from)

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO workers
               (id, corporation_id, first_name, last_name, profession_type,
                experience_years, origin_country, languages, visa_type, visa_number,
                visa_valid_from, visa_valid_until, notes, extra_fields)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (worker_id, corp_id, data.first_name, data.last_name,
             data.profession_type, exp_years, data.origin_country,
             json.dumps(data.languages), data.visa_type, data.visa_number,
             data.visa_valid_from, data.visa_valid_until, data.notes, extra)
        )
        conn.commit()
        return {"id": worker_id, "experience_years": exp_years, "experience_range": exp_range(exp_years)}
    finally:
        conn.close()


@router.post("/bulk", status_code=201)
def bulk_create_workers(
    data: WorkerBulkCreate,
    x_org_id: Optional[str] = Header(default=None),
):
    corp_id = data.corporation_id or x_org_id
    if not corp_id:
        raise HTTPException(status_code=400, detail="corporation_id required")
    if not 1 <= data.quantity <= 50:
        raise HTTPException(status_code=400, detail="quantity must be 1-50")

    exp_years = _resolve_exp(data.experience_years, data.experience_range)
    prefix = data.name_prefix or "עובד"
    extra  = _build_extra(None, data.available_region, data.available_from)
    created_ids = []

    conn = get_db()
    try:
        cur = conn.cursor()
        for i in range(1, data.quantity + 1):
            wid = str(uuid.uuid4())
            cur.execute(
                """INSERT INTO workers
                   (id, corporation_id, first_name, last_name, profession_type,
                    experience_years, origin_country, languages,
                    visa_valid_until, notes, extra_fields)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (wid, corp_id, prefix, str(i),
                 data.profession_type, exp_years, data.origin_country,
                 json.dumps(data.languages),
                 data.visa_valid_until, data.notes, extra)
            )
            created_ids.append(wid)
        conn.commit()
        return {
            "created": len(created_ids),
            "ids": created_ids,
            "experience_range": exp_range(exp_years),
        }
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@router.get("")
def list_workers(
    corporation_id: Optional[str] = None,
    profession: Optional[str] = Query(None, alias="profession"),
    status: Optional[str] = None,
    visa_until_min: Optional[date] = None,
    limit: int = 200,
    x_org_id: Optional[str] = Header(default=None),
):
    corp_id = corporation_id or x_org_id
    conn = get_db()
    try:
        cur = conn.cursor()
        filters = ["deleted_at IS NULL"]
        params: list = []

        if corp_id:
            filters.append("corporation_id = %s"); params.append(corp_id)
        if profession:
            filters.append("profession_type = %s"); params.append(profession)
        if status:
            filters.append("status = %s"); params.append(status)
        if visa_until_min:
            filters.append("visa_valid_until >= %s"); params.append(visa_until_min)

        where = " AND ".join(filters)
        cur.execute(
            f"SELECT * FROM workers WHERE {where} ORDER BY created_at DESC LIMIT %s",
            params + [limit]
        )
        rows = cur.fetchall()
        # Deserialize JSON fields + add computed experience_range
        for row in rows:
            if isinstance(row.get("languages"), str):
                try: row["languages"] = json.loads(row["languages"])
                except: row["languages"] = []
            if isinstance(row.get("extra_fields"), str):
                try: row["extra_fields"] = json.loads(row["extra_fields"])
                except: row["extra_fields"] = {}
            row["experience_range"] = exp_range(row.get("experience_years", 0))
            for k, v in row.items():
                if hasattr(v, "isoformat"): row[k] = v.isoformat()
        return rows
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
        if isinstance(row.get("languages"), str):
            try: row["languages"] = json.loads(row["languages"])
            except: row["languages"] = []
        if isinstance(row.get("extra_fields"), str):
            try: row["extra_fields"] = json.loads(row["extra_fields"])
            except: row["extra_fields"] = {}
        row["experience_range"] = exp_range(row.get("experience_years", 0))
        for k, v in row.items():
            if hasattr(v, "isoformat"): row[k] = v.isoformat()
        return row
    finally:
        conn.close()


@router.patch("/{worker_id}")
def update_worker(worker_id: str, data: WorkerUpdate):
    conn = get_db()
    try:
        cur = conn.cursor()

        # If updating experience_range, resolve it
        exp_years = None
        if data.experience_range is not None:
            exp_years = EXP_RANGE_TO_YEARS.get(data.experience_range, data.experience_years or 0)
        elif data.experience_years is not None:
            exp_years = data.experience_years

        # Merge extra_fields with available_region / available_from
        if data.available_region or data.available_from:
            cur.execute("SELECT extra_fields FROM workers WHERE id=%s", (worker_id,))
            existing = cur.fetchone()
            base = {}
            if existing and existing.get("extra_fields"):
                try: base = json.loads(existing["extra_fields"])
                except: base = {}
            if data.available_region: base["available_region"] = data.available_region
            if data.available_from:   base["available_from"]   = data.available_from
            data = data.model_copy(update={"extra_fields": base})

        updates, params = [], []
        if data.profession_type  is not None: updates.append("profession_type=%s");  params.append(data.profession_type)
        if exp_years             is not None: updates.append("experience_years=%s"); params.append(exp_years)
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
