"""Pivot/v2 Phase 3 — free-text search over ads.

Public endpoint: anyone (even non-logged-in) can search and see ads.
Subscription is required only to REVEAL the corp's contact info — that
lives on /api/ads/{id}/contact-reveal in ads.py.

Pipeline:
  1. query_rewriter.rewrite(query) → structured filters
  2. SQL SELECT against ads with NULL-permissive filtering
     (NULL field on the ad = "willing to consider any")
  3. featured_until ranks first, then published_at desc
  4. Phase 5 will insert a vector rerank between (2) and (3).

Contact info (corp's phone/email) is NEVER returned by /search — the
results are anonymised and the frontend asks for contact reveal per
ad, behind the subscription gate.
"""
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.db import get_db
from app.services.query_rewriter import rewrite

router = APIRouter()

RESULT_LIMIT = 50


class SearchIn(BaseModel):
    query: str = Field(..., min_length=2, max_length=500)


def _serialize_ad(row: dict) -> dict:
    # Strip contact-sensitive fields. Owner id is kept so the frontend
    # can call /ads/{id}/contact-reveal once the contractor decides
    # to reach out (subscription gate fires there).
    out = {
        "id":               row["id"],
        "owner_entity_id":  row["owner_entity_id"],
        "ad_type":          row["ad_type"],
        "title_he":         row["title_he"],
        "body_he":          row["body_he"],
        "profession_code":  row["profession_code"],
        "origin_country":   row["origin_country"],
        "region":           row["region"],
        "quantity":         row["quantity"],
        "experience_min_months": row["experience_min_months"],
        "visa_valid_until": row["visa_valid_until"].isoformat() if row.get("visa_valid_until") else None,
        "languages":        row.get("languages"),
        "featured_until":   row["featured_until"].isoformat() if row.get("featured_until") else None,
        "published_at":     row["published_at"].isoformat() if row.get("published_at") else None,
        "expires_at":       row["expires_at"].isoformat()   if row.get("expires_at")   else None,
    }
    return out


@router.post("")
def search(body: SearchIn):
    filters = rewrite(body.query)

    # Build dynamic WHERE — NULL-permissive (corp left the field blank → matches any contractor filter).
    wheres = [
        "a.ad_type = %s",
        "a.active = TRUE",
        "a.deleted_at IS NULL",
        "(a.expires_at IS NULL OR a.expires_at > NOW())",
    ]
    params: list[object] = [filters["ad_type"]]

    if filters.get("profession_code"):
        wheres.append("(a.profession_code IS NULL OR a.profession_code = %s)")
        params.append(filters["profession_code"])
    if filters.get("origin_country"):
        wheres.append("(a.origin_country  IS NULL OR a.origin_country  = %s)")
        params.append(filters["origin_country"])
    if filters.get("region"):
        wheres.append("(a.region IS NULL OR a.region = %s)")
        params.append(filters["region"])
    if filters.get("quantity"):
        wheres.append("(a.quantity IS NULL OR a.quantity >= %s)")
        params.append(filters["quantity"])

    sql = f"""
        SELECT a.*
          FROM ads a
         WHERE {' AND '.join(wheres)}
         ORDER BY
           (a.featured_until IS NOT NULL AND a.featured_until > NOW()) DESC,
           a.featured_until DESC,
           a.published_at  DESC
         LIMIT {RESULT_LIMIT}
    """

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        rows = cur.fetchall()
        return {
            "filters":  filters,
            "results":  [_serialize_ad(r) for r in rows],
            "total":    len(rows),
        }
    finally:
        conn.close()
