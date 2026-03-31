from fastapi import APIRouter
from app.db import get_db

router = APIRouter()


@router.get("/professions")
def get_professions():
    conn = get_db()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT * FROM profession_types WHERE is_active = TRUE ORDER BY sort_order")
        return cur.fetchall()
    finally:
        conn.close()


@router.get("/origins")
def get_origins():
    conn = get_db()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT * FROM origin_countries WHERE is_active = TRUE ORDER BY name_en")
        return cur.fetchall()
    finally:
        conn.close()


@router.get("/regions")
def get_regions():
    conn = get_db()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT * FROM regions WHERE is_active = TRUE ORDER BY name_he")
        return cur.fetchall()
    finally:
        conn.close()
