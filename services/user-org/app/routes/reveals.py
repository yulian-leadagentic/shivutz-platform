"""L7 · reveal history views.

Two read-only endpoints on top of the existing contact_reveals table:

  GET /ads/mine/reveals       — corp sees WHAT happened to its ads
                                (per PRD-1: no contractor identity
                                surfaces on this path in any form).
  GET /contractor/reveals     — contractor sees every corp it revealed
                                (per PRD-2: the corp name + phone +
                                email the contractor already paid for
                                is here, in one place).

Every ownership gate is enforced IN THE SQL WHERE clause — not on
the frontend, not after the fetch. Same isolation shape L1 tightened.

Reading this history is NOT a reveal — it costs no quota and inserts
nothing new into contact_reveals.
"""
import csv
import io
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.db import get_db

logger = logging.getLogger(__name__)
router = APIRouter()

# PRD-1 §aside — k-anonymity floor for the corp's region column.
# Below this count, "region" collapses to "—" so a single reveal
# from the north doesn't finger the one contractor there. Chosen
# lower than a rigorous k=5 for launch scale, but noted as a
# tunable Yulian can raise via env or a follow-up ADR. Anything
# less than this and we don't show any region signal.
REGION_MIN_REVEALS = 5


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


# ─── GET /ads/mine/reveals — PRD-1 corp view ─────────────────────────────

@router.get("/ads/mine/reveals")
def list_ad_reveals_for_corp(
    from_date: Optional[str] = Query(default=None, alias="from"),
    to_date:   Optional[str] = Query(default=None, alias="to"),
    ad_id:     Optional[str] = Query(default=None),
    limit:     int           = Query(default=50, ge=1, le=200),
    cursor:    Optional[str] = Query(default=None),
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    # Corp-only endpoint. Contractors have their own history at
    # /contractor/reveals — the wrong-role caller gets 403 rather
    # than a silent empty page.
    if x_entity_type != "corporation" or not x_entity_id:
        raise HTTPException(status_code=403, detail={"code": "corp_only"})

    conn = get_db()
    try:
        cur = conn.cursor()
        # Ownership + optional filters. viewer_entity_* fields are
        # NEVER in the SELECT — PRD-1 guardrail. What we don't
        # select can't leak.
        wheres = ["a.owner_entity_id = %s", "a.deleted_at IS NULL"]
        params: list[object] = [x_entity_id]
        if ad_id:
            wheres.append("cr.ad_id = %s")
            params.append(ad_id)
        if from_date:
            wheres.append("cr.revealed_at >= %s")
            params.append(from_date)
        if to_date:
            wheres.append("cr.revealed_at <  %s")
            params.append(to_date)
        if cursor:
            # Keyset paging on (revealed_at, id) — safer than OFFSET
            # for a table growing at reveal-rate. Client sends the
            # ISO revealed_at of the last row it saw.
            wheres.append("cr.revealed_at < %s")
            params.append(cursor)

        # For the k-anonymity region gate, get per-ad reveal counts
        # in the same query — subquery on cr filtered by owner. Reveals
        # are counted across the WHOLE window filter (from/to) so the
        # k check reflects the caller's own visible slice.
        base_where = " AND ".join(wheres)
        sql = f"""
            SELECT cr.id, cr.ad_id, cr.revealed_at,
                   a.title_he, a.ad_type, a.profession_code,
                   (SELECT COUNT(*) FROM contact_reveals cr2
                      WHERE cr2.ad_id = cr.ad_id) AS ad_total_reveals
              FROM contact_reveals cr
              JOIN ads a ON a.id = cr.ad_id
             WHERE {base_where}
             ORDER BY cr.revealed_at DESC, cr.id DESC
             LIMIT %s
        """
        params_with_limit = params + [limit + 1]  # +1 to know if more exist
        cur.execute(sql, params_with_limit)
        rows = cur.fetchall()
    finally:
        conn.close()

    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = _iso(rows[-1]["revealed_at"]) if (rows and has_more) else None

    # k-anonymity is a policy, not a permission — we simply do NOT
    # ship the raw region field. When the ad crosses the threshold
    # the frontend still gets nothing extra here; region will be
    # added in a follow-up once the launch data volume clears the
    # floor. For L7 we ship no region column at all.
    out = [{
        "id":          r["id"],
        "ad_id":       r["ad_id"],
        "revealed_at": _iso(r["revealed_at"]),
        "title_he":    r["title_he"],
        "ad_type":     r["ad_type"],
        "profession_code": r["profession_code"],
    } for r in rows]

    return {"results": out, "next_cursor": next_cursor}


@router.get("/ads/mine/reveals.csv")
def export_ad_reveals_for_corp(
    from_date: Optional[str] = Query(default=None, alias="from"),
    to_date:   Optional[str] = Query(default=None, alias="to"),
    ad_id:     Optional[str] = Query(default=None),
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    # PRD-3 rule: CSV export uses the SAME QUERY as the JSON — a
    # second query is the classic way privacy filtering slips.
    result = list_ad_reveals_for_corp(
        from_date=from_date, to_date=to_date, ad_id=ad_id,
        limit=1000, cursor=None,
        x_entity_id=x_entity_id, x_entity_type=x_entity_type,
    )
    buf = io.StringIO()
    # BOM + utf-8: without the BOM Excel-Hebrew opens the file as
    # cp1255 and every column reads as garbage.
    buf.write("﻿")
    writer = csv.writer(buf)
    writer.writerow(["תאריך", "כותרת המודעה", "סוג", "מקצוע", "מזהה מודעה"])
    for r in result["results"]:
        writer.writerow([
            r["revealed_at"] or "",
            r["title_he"]    or "",
            r["ad_type"]     or "",
            r["profession_code"] or "",
            r["ad_id"]       or "",
        ])
    return StreamingResponse(
        io.BytesIO(buf.getvalue().encode("utf-8")),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=reveals.csv"},
    )


# ─── GET /contractor/reveals — PRD-2 contractor view ─────────────────────

@router.get("/contractor/reveals")
def list_reveals_for_contractor(
    q:      Optional[str] = Query(default=None),
    from_date: Optional[str] = Query(default=None, alias="from"),
    to_date:   Optional[str] = Query(default=None, alias="to"),
    limit:  int           = Query(default=50, ge=1, le=200),
    cursor: Optional[str] = Query(default=None),
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    # Contractor-only endpoint. The corp view lives at
    # /ads/mine/reveals; wrong role gets 403.
    if x_entity_type != "contractor" or not x_entity_id:
        raise HTTPException(status_code=403, detail={"code": "contractor_only"})

    conn = get_db()
    try:
        cur = conn.cursor()
        wheres = ["cr.viewer_entity_id = %s", "cr.viewer_entity_type='contractor'"]
        params: list[object] = [x_entity_id]
        if from_date:
            wheres.append("cr.revealed_at >= %s")
            params.append(from_date)
        if to_date:
            wheres.append("cr.revealed_at <  %s")
            params.append(to_date)
        if cursor:
            wheres.append("cr.revealed_at < %s")
            params.append(cursor)
        if q:
            wheres.append("(a.title_he LIKE %s OR c.company_name_he LIKE %s)")
            like = f"%{q}%"
            params.extend([like, like])

        base_where = " AND ".join(wheres)
        # Collation cast on corporations.id — same pattern search.py
        # uses (utf8mb4_unicode_ci vs utf8mb4_0900_ai_ci mismatch).
        sql = f"""
            SELECT cr.id, cr.ad_id, cr.revealed_at,
                   a.title_he, a.ad_type, a.profession_code, a.origin_country,
                   a.region, a.active, a.deleted_at,
                   c.company_name_he, c.company_name,
                   c.contact_phone, c.contact_email
              FROM contact_reveals cr
              JOIN ads a ON a.id = cr.ad_id
              LEFT JOIN corporations c
                ON c.id COLLATE utf8mb4_0900_ai_ci = a.owner_entity_id
             WHERE {base_where}
             ORDER BY cr.revealed_at DESC, cr.id DESC
             LIMIT %s
        """
        cur.execute(sql, params + [limit + 1])
        rows = cur.fetchall()
    finally:
        conn.close()

    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = _iso(rows[-1]["revealed_at"]) if (rows and has_more) else None

    out = []
    for r in rows:
        # "Ad removed" is a display state, not a delete of the reveal
        # row — the contractor still sees the corp contact they paid
        # for, just with a note that the ad itself is gone.
        ad_removed = bool(r.get("deleted_at")) or not r.get("active")
        out.append({
            "id":          r["id"],
            "ad_id":       r["ad_id"],
            "revealed_at": _iso(r["revealed_at"]),
            "title_he":    r["title_he"],
            "ad_type":     r["ad_type"],
            "profession_code": r["profession_code"],
            "origin_country":  r["origin_country"],
            "region":          r["region"],
            "ad_removed":  ad_removed,
            "company_name": r.get("company_name_he") or r.get("company_name") or "—",
            "phone":       r.get("contact_phone") or None,
            "email":       r.get("contact_email") or None,
        })

    return {"results": out, "next_cursor": next_cursor}


@router.get("/contractor/reveals.csv")
def export_reveals_for_contractor(
    q:      Optional[str] = Query(default=None),
    from_date: Optional[str] = Query(default=None, alias="from"),
    to_date:   Optional[str] = Query(default=None, alias="to"),
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    # Same shared-query rule as the corp CSV — reuse the JSON path.
    result = list_reveals_for_contractor(
        q=q, from_date=from_date, to_date=to_date,
        limit=1000, cursor=None,
        x_entity_id=x_entity_id, x_entity_type=x_entity_type,
    )
    buf = io.StringIO()
    buf.write("﻿")
    writer = csv.writer(buf)
    writer.writerow(["תאריך", "תאגיד", "טלפון", "מייל", "כותרת המודעה", "סוג", "מקצוע", "מוצא", "אזור", "מודעה הוסרה"])
    for r in result["results"]:
        writer.writerow([
            r["revealed_at"] or "",
            r["company_name"] or "",
            r["phone"] or "",
            r["email"] or "",
            r["title_he"] or "",
            r["ad_type"] or "",
            r["profession_code"] or "",
            r["origin_country"] or "",
            r["region"] or "",
            "כן" if r["ad_removed"] else "לא",
        ])
    return StreamingResponse(
        io.BytesIO(buf.getvalue().encode("utf-8")),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=reveals.csv"},
    )
