"""Pivot/v2 admin — moderate the ad marketplace.

Reads from org_db.ads directly (schema owned by user-org). Admin can
hide/unhide/soft-delete any ad. Corp-side editing lives in user-org's
own /ads router — this is the moderation surface.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.db import get_db

router = APIRouter()


def _serialize(row: dict) -> dict:
    out = dict(row)
    for k, v in list(out.items()):
        if isinstance(v, datetime):
            out[k] = v.isoformat()
    return out


# ── List / filter ──────────────────────────────────────────────────────────

@router.get("/ads")
def list_ads(
    ad_type: Optional[str] = Query(default=None),          # 'worker' | 'housing'
    active:  Optional[bool] = Query(default=None),
    hidden:  Optional[bool] = Query(default=False),        # include soft-deleted
    q:       Optional[str] = Query(default=None),          # title/body search
    limit:   int  = Query(default=200, le=1000),
):
    wheres = []
    params: list[object] = []
    if not hidden:
        wheres.append("a.deleted_at IS NULL")
    if ad_type in ("worker", "housing"):
        wheres.append("a.ad_type = %s")
        params.append(ad_type)
    if active is not None:
        wheres.append("a.active = %s")
        params.append(1 if active else 0)
    if q:
        wheres.append("(a.title_he LIKE %s OR a.body_he LIKE %s)")
        params.extend([f"%{q}%", f"%{q}%"])

    sql = f"""
        SELECT a.*,
               COALESCE(c.company_name_he, c.company_name) AS owner_name
          FROM ads a
          LEFT JOIN corporations c ON c.id = a.owner_entity_id
         {'WHERE ' + ' AND '.join(wheres) if wheres else ''}
         ORDER BY a.created_at DESC
         LIMIT {limit}
    """
    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        return [_serialize(r) for r in cur.fetchall()]
    finally:
        conn.close()


# ── Hide / unhide / delete ────────────────────────────────────────────────

@router.post("/ads/{ad_id}/hide", status_code=204)
def hide_ad(ad_id: str):
    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        cur.execute("UPDATE ads SET active=FALSE WHERE id=%s AND deleted_at IS NULL", (ad_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="ad_not_found")
        conn.commit()
    finally:
        conn.close()


@router.post("/ads/{ad_id}/unhide", status_code=204)
def unhide_ad(ad_id: str):
    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        cur.execute("UPDATE ads SET active=TRUE WHERE id=%s AND deleted_at IS NULL", (ad_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="ad_not_found")
        conn.commit()
    finally:
        conn.close()


@router.delete("/ads/{ad_id}", status_code=204)
def delete_ad(ad_id: str):
    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE ads SET deleted_at=NOW(), active=FALSE WHERE id=%s AND deleted_at IS NULL",
            (ad_id,),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="ad_not_found")
        conn.commit()
    finally:
        conn.close()
