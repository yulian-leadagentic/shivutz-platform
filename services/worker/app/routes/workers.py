from fastapi import APIRouter, HTTPException, Header, Query
from pydantic import BaseModel
from typing import List, Optional
from datetime import date
import uuid, json, secrets

from app.db import get_db

router = APIRouter()


# ── internal_id (EMP-XXXXXXXX) helpers ────────────────────────────────────

def _generate_internal_id() -> str:
    """Generate an EMP-{8 random hex} ID. Caller must handle the rare
    collision retry (uniqueness enforced by DB index)."""
    return f"EMP-{secrets.token_hex(4).upper()}"


def _insert_with_unique_internal_id(cur, sql: str, params_with_internal_id_index, attempts: int = 5):
    """Helper to retry once on UNIQUE collision of `internal_id`.
    `params_with_internal_id_index` is (params_tuple, index_of_internal_id)."""
    params, idx = params_with_internal_id_index
    last_err = None
    for _ in range(attempts):
        try:
            cur.execute(sql, params)
            return params[idx]
        except Exception as e:
            last_err = e
            if "uq_internal_id" not in str(e):
                raise
            new_id = _generate_internal_id()
            params = list(params)
            params[idx] = new_id
            params = tuple(params)
    raise last_err

# ── Experience range helpers ──────────────────────────────────────────────

# Month-based ranges (new) + legacy year-based ranges (old) → experience_years
EXP_RANGE_TO_YEARS = {
    # Month-based (new): store lower bound in months, convert to years for DB
    "0-6":   0,
    "6-12":  0,   # < 1 year
    "12-24": 1,
    "24-36": 2,
    "36+":   3,
    # Legacy year-based (old):
    "1-3": 1,
    "3-5": 3,
    "5+":  5,
}

def exp_range(years: int) -> str:
    """Convert experience_years to month-based range string."""
    months = years * 12
    if months >= 36: return "36+"
    if months >= 24: return "24-36"
    if months >= 12: return "12-24"
    if months >= 6:  return "6-12"
    return "0-6"


# ── Models ────────────────────────────────────────────────────────────────

class WorkerCreate(BaseModel):
    corporation_id: Optional[str] = None   # falls back to x-org-id header
    first_name: str
    last_name: str
    profession_type: str
    experience_years: int = 0
    experience_range: Optional[str] = None  # month-based: "0-6"|"6-12"|"12-24"|"24-36"|"36+"
    years_in_israel: Optional[int] = None    # NEW — visible to contractor pre-approval
    origin_country: str
    languages: List[str] = []
    visa_type: Optional[str] = None
    visa_number: Optional[str] = None
    visa_valid_from: Optional[date] = None
    visa_valid_until: Optional[date] = None
    available_region: Optional[str] = None   # stored in extra_fields
    available_from: Optional[str] = None     # stored in extra_fields
    employee_number: Optional[str] = None    # stored in extra_fields; auto-generated if omitted
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
    years_in_israel: Optional[int] = None
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
    employee_number: Optional[str] = None    # stored in extra_fields
    notes: Optional[str] = None
    extra_fields: Optional[dict] = None


# ── Helpers ───────────────────────────────────────────────────────────────

def _resolve_exp(years: int, range_str: Optional[str]) -> int:
    if range_str and range_str in EXP_RANGE_TO_YEARS:
        return EXP_RANGE_TO_YEARS[range_str]
    return years

def _build_extra(
    base: Optional[dict],
    available_region: Optional[str],
    available_from: Optional[str],
    experience_range: Optional[str] = None,
    employee_number: Optional[str] = None,
) -> Optional[str]:
    extra = dict(base or {})
    if available_region:  extra["available_region"]  = available_region
    if available_from:    extra["available_from"]    = available_from
    if experience_range:  extra["experience_range"]  = experience_range
    if employee_number:   extra["employee_number"]   = employee_number
    return json.dumps(extra) if extra else None

def _generate_employee_number(conn, corp_id: str) -> str:
    cur = conn.cursor()
    cur.execute(
        "SELECT COUNT(*) as cnt FROM workers WHERE corporation_id = %s AND deleted_at IS NULL",
        (corp_id,)
    )
    row = cur.fetchone()
    count = (row.get("cnt") or 0) + 1
    return f"W-{count:04d}"


# ── Routes ────────────────────────────────────────────────────────────────

def _require_corp_tier_2(corp_id: str) -> None:
    """Block worker publishing for corporations that haven't been admin-
    approved as 'תאגיד מאושר'. Tier_0 / tier_1 corporations can use the
    rest of the platform; only publishing/offering workers is gated."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT verification_tier FROM org_db.corporations WHERE id = %s AND deleted_at IS NULL",
            (corp_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="corporation_not_found")
        if row["verification_tier"] != "tier_2":
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "corporation_not_approved",
                    "message": "פרסום עובדים מותר רק לתאגידים מאושרים. אישור התאגיד מבוצע על ידי מנהל המערכת.",
                    "current_tier": row["verification_tier"],
                },
            )
    finally:
        conn.close()


@router.post("", status_code=201)
def create_worker(
    data: WorkerCreate,
    x_org_id: Optional[str] = Header(default=None),
):
    corp_id = data.corporation_id or x_org_id
    if not corp_id:
        raise HTTPException(status_code=400, detail="corporation_id required")
    _require_corp_tier_2(corp_id)

    exp_years = _resolve_exp(data.experience_years, data.experience_range)
    worker_id = str(uuid.uuid4())

    conn = get_db()
    try:
        emp_num = data.employee_number or _generate_employee_number(conn, corp_id)
        stored_range = data.experience_range or exp_range(exp_years)
        extra = _build_extra(
            data.extra_fields, data.available_region, data.available_from,
            experience_range=stored_range, employee_number=emp_num,
        )
        cur = conn.cursor()
        internal_id = _generate_internal_id()
        # Retry-on-collision pattern: rare, but cheap to handle.
        for attempt in range(5):
            try:
                cur.execute(
                    """INSERT INTO workers
                       (id, corporation_id, internal_id, first_name, last_name, profession_type,
                        experience_years, years_in_israel, origin_country, languages, visa_type, visa_number,
                        visa_valid_from, visa_valid_until, notes, extra_fields)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (worker_id, corp_id, internal_id, data.first_name, data.last_name,
                     data.profession_type, exp_years, data.years_in_israel, data.origin_country,
                     json.dumps(data.languages), data.visa_type, data.visa_number,
                     data.visa_valid_from, data.visa_valid_until, data.notes, extra)
                )
                break
            except Exception as e:
                if "uq_internal_id" not in str(e) or attempt == 4:
                    raise
                internal_id = _generate_internal_id()
        conn.commit()
        return {
            "id": worker_id,
            "internal_id": internal_id,
            "experience_years": exp_years,
            "experience_range": stored_range,
            "years_in_israel": data.years_in_israel,
            "employee_number": emp_num,
        }
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
    _require_corp_tier_2(corp_id)
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
            for attempt in range(5):
                internal_id = _generate_internal_id()
                try:
                    cur.execute(
                        """INSERT INTO workers
                           (id, corporation_id, internal_id, first_name, last_name, profession_type,
                            experience_years, years_in_israel, origin_country, languages,
                            visa_valid_until, notes, extra_fields)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (wid, corp_id, internal_id, prefix, str(i),
                         data.profession_type, exp_years, data.years_in_israel, data.origin_country,
                         json.dumps(data.languages),
                         data.visa_valid_until, data.notes, extra)
                    )
                    break
                except Exception as e:
                    if "uq_internal_id" not in str(e) or attempt == 4:
                        raise
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
            # Prefer stored range (month-based) over computed fallback
            stored = (row.get("extra_fields") or {}).get("experience_range")
            row["experience_range"] = stored or exp_range(row.get("experience_years", 0))
            # Promote available_region to top-level so matching engine can read it
            row["available_region"] = (row.get("extra_fields") or {}).get("available_region", "")
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
        stored = (row.get("extra_fields") or {}).get("experience_range")
        row["experience_range"] = stored or exp_range(row.get("experience_years", 0))
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

        # Merge extra_fields with available_region / available_from / employee_number / experience_range
        if data.available_region or data.available_from or data.employee_number or data.experience_range:
            cur.execute("SELECT extra_fields FROM workers WHERE id=%s", (worker_id,))
            existing = cur.fetchone()
            base = {}
            if existing and existing.get("extra_fields"):
                try: base = json.loads(existing["extra_fields"])
                except: base = {}
            if data.available_region:  base["available_region"]  = data.available_region
            if data.available_from:    base["available_from"]    = data.available_from
            if data.employee_number:   base["employee_number"]   = data.employee_number
            if data.experience_range:  base["experience_range"]  = data.experience_range
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
