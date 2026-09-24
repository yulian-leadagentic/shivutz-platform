from fastapi import APIRouter
from app.db import get_db

router = APIRouter()


@router.get("/professions")
def get_professions():
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM profession_types WHERE is_active = TRUE ORDER BY sort_order")
        return cur.fetchall()
    finally:
        conn.close()


@router.get("/origins")
def get_origins():
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM origin_countries WHERE is_active = TRUE ORDER BY name_en")
        return cur.fetchall()
    finally:
        conn.close()


@router.get("/regions")
def get_regions():
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM regions WHERE is_active = TRUE ORDER BY name_he")
        return cur.fetchall()
    finally:
        conn.close()


# R30 §26 · all three catalogs in ONE round-trip.
#
# The home page fetched /enums/professions, /origins and /regions
# separately — three of an anonymous visitor's request budget for three
# small, static reference tables that are always wanted together. The
# §26 target is a home load under 8 requests; this is the cheapest
# three-into-one available, and it reuses one DB connection instead of
# opening three.
#
# The individual routes above stay: other screens fetch a single
# catalog (the worker forms want professions only), and removing them
# would be a breaking change for no gain.
@router.get("/all")
def get_all_enums():
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM profession_types WHERE is_active = TRUE ORDER BY sort_order")
        professions = cur.fetchall()
        cur.execute("SELECT * FROM origin_countries WHERE is_active = TRUE ORDER BY name_en")
        origins = cur.fetchall()
        cur.execute("SELECT * FROM regions WHERE is_active = TRUE ORDER BY name_he")
        regions = cur.fetchall()
        return {"professions": professions, "origins": origins, "regions": regions}
    finally:
        conn.close()
