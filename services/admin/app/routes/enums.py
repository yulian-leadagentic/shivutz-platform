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


@router.get("/professions")
def list_professions():
    conn = get_db("worker_db")
    try:
        cur = conn.cursor(dictionary=True)
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
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT * FROM origin_countries ORDER BY name_en")
        return cur.fetchall()
    finally:
        conn.close()


@router.post("/origins", status_code=201)
def add_origin(data: CountryCreate):
    conn = get_db("worker_db")
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO origin_countries (code, name_he, name_en) VALUES (%s,%s,%s)",
            (data.code, data.name_he, data.name_en)
        )
        conn.commit()
        return {"code": data.code}
    finally:
        conn.close()
