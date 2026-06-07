from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.db import get_db

router = APIRouter()


class ProfessionCreate(BaseModel):
    code: str
    name_he: str
    name_en: str
    category: Optional[str] = None
    sort_order: int = 0


class CountryCreate(BaseModel):
    code: str
    name_he: str
    name_en: str


class CountryUpdate(BaseModel):
    # All optional — admin can rename just the Hebrew label without
    # touching the others.
    name_he: Optional[str] = None
    name_en: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("/professions")
def list_professions():
    conn = get_db("worker_db")
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM profession_types ORDER BY sort_order")
        return cur.fetchall()
    finally:
        conn.close()


@router.post("/professions", status_code=201)
def add_profession(data: ProfessionCreate):
    conn = get_db("worker_db")
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO profession_types (code, name_he, name_en, category, sort_order) VALUES (%s,%s,%s,%s,%s)",
            (data.code, data.name_he, data.name_en, data.category, data.sort_order)
        )
        conn.commit()
        return {"code": data.code}
    finally:
        conn.close()


@router.delete("/professions/{code}", status_code=204)
def deactivate_profession(code: str):
    conn = get_db("worker_db")
    try:
        cur = conn.cursor()
        cur.execute("UPDATE profession_types SET is_active=FALSE WHERE code=%s", (code,))
        conn.commit()
    finally:
        conn.close()


@router.get("/origins")
def list_origins():
    conn = get_db("worker_db")
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM origin_countries ORDER BY name_en")
        return cur.fetchall()
    finally:
        conn.close()


@router.post("/origins", status_code=201)
def add_origin(data: CountryCreate):
    code = data.code.strip().upper()
    if not code or len(code) != 2:
        raise HTTPException(status_code=400, detail="invalid_country_code")
    conn = get_db("worker_db")
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO origin_countries (code, name_he, name_en, is_active) "
            "VALUES (%s,%s,%s,1) "
            "ON DUPLICATE KEY UPDATE name_he=VALUES(name_he), "
            "name_en=VALUES(name_en), is_active=1",
            (code, data.name_he.strip(), data.name_en.strip())
        )
        conn.commit()
        return {"code": code}
    finally:
        conn.close()


# QA-R3 #19b — admin country CRUD UI. Supports renaming + soft-
# enable/disable so historical worker rows that still reference a
# deactivated country keep their FK valid.
@router.patch("/origins/{code}")
def update_origin(code: str, data: CountryUpdate):
    code = code.strip().upper()
    fields: list[str] = []
    params: list = []
    if data.name_he is not None:
        fields.append("name_he=%s")
        params.append(data.name_he.strip())
    if data.name_en is not None:
        fields.append("name_en=%s")
        params.append(data.name_en.strip())
    if data.is_active is not None:
        fields.append("is_active=%s")
        params.append(1 if data.is_active else 0)
    if not fields:
        raise HTTPException(status_code=400, detail="no_fields_to_update")
    params.append(code)
    conn = get_db("worker_db")
    try:
        cur = conn.cursor()
        cur.execute(f"UPDATE origin_countries SET {', '.join(fields)} WHERE code=%s", tuple(params))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="country_not_found")
        conn.commit()
        return {"code": code, "updated_fields": [f.split('=')[0] for f in fields]}
    finally:
        conn.close()


@router.delete("/origins/{code}", status_code=204)
def deactivate_origin(code: str):
    """Soft-delete via is_active=0. Historical worker rows referencing this
    code stay intact; the country just stops appearing in pickers + new
    bids/tenders. Re-enable with PATCH is_active=true."""
    code = code.strip().upper()
    conn = get_db("worker_db")
    try:
        cur = conn.cursor()
        cur.execute("UPDATE origin_countries SET is_active=0 WHERE code=%s", (code,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="country_not_found")
        conn.commit()
    finally:
        conn.close()
