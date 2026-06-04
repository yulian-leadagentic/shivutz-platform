"""Admin endpoints to manage the רשות האוכלוסין annual manpower-corps list.

POST /admin/gov-corps-registry/import — upload a year's PDF.
GET  /admin/gov-corps-registry/years    — list years that have data.
GET  /admin/gov-corps-registry/{year}    — preview rows for one year.

Auth: handled by the gateway — only admin users can hit /admin/* routes.
The x-user-id header is the admin's user id which we record on the
imported_by column for audit.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile

from app.db import get_db
from app.services import gov_corp_list

router = APIRouter()


@router.post("/gov-corps-registry/import")
async def import_gov_pdf(
    source_year: int = Form(...),
    file: UploadFile = File(...),
    x_user_id: Optional[str] = Header(default=None),
):
    """Parse the uploaded gov PDF and replace all rows for `source_year`.

    Returns a small summary so the admin UI can show counts after upload.
    """
    if source_year < 2020 or source_year > 2100:
        raise HTTPException(status_code=400, detail="invalid_source_year")

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="empty_file")
    # Quick sanity check on the magic bytes — pdfplumber would also
    # reject non-PDF input, but a friendlier 400 here is nicer for the
    # admin who picked the wrong file.
    if not pdf_bytes.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="not_a_pdf")

    try:
        rows = gov_corp_list.parse_pdf_bytes(pdf_bytes)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"pdf_parse_failed: {e}")

    # Count matchable rows BEFORE insert so the summary reflects the
    # rows we'll actually use to auto-promote corps.
    matchable = sum(1 for r in rows if r.get("business_number"))

    conn = get_db("org_db")
    try:
        inserted = gov_corp_list.insert_rows(conn, rows, source_year, x_user_id)

        # Side-effect: for every existing corp whose business_number is
        # in the freshly-imported set, bump gov_registry_source_year +
        # _matched_at. Also promote to tier_2 if they're still tier_0/1
        # — this is the "yearly re-match" path described in the spec.
        cur = conn.cursor()
        bns = [r["business_number"] for r in rows if r.get("business_number")]
        promoted = 0
        if bns:
            # Chunked IN clause to avoid the MySQL packet limit; the
            # gov list is ~200 rows so one chunk is fine, but be safe.
            for i in range(0, len(bns), 500):
                chunk = bns[i:i + 500]
                placeholders = ",".join(["%s"] * len(chunk))
                # Update tier_0 / tier_1 → tier_2 first (counts the promotion).
                cur.execute(
                    f"""UPDATE org_db.corporations
                          SET verification_tier        = 'tier_2',
                              verification_method      = 'gov_list_match',
                              verified_at              = COALESCE(verified_at, NOW()),
                              gov_registry_source_year = %s,
                              gov_registry_matched_at  = NOW(),
                              approval_status          = 'approved',
                              approved_at              = COALESCE(approved_at, NOW())
                        WHERE business_number IN ({placeholders})
                          AND deleted_at IS NULL
                          AND verification_tier IN ('tier_0', 'tier_1')""",
                    [source_year] + chunk,
                )
                promoted += cur.rowcount
                # Bump source_year on already-tier_2 corps too — they
                # stay tier_2 but the "matched year" advances.
                cur.execute(
                    f"""UPDATE org_db.corporations
                          SET gov_registry_source_year = %s,
                              gov_registry_matched_at  = NOW()
                        WHERE business_number IN ({placeholders})
                          AND deleted_at IS NULL
                          AND verification_tier = 'tier_2'""",
                    [source_year] + chunk,
                )
        conn.commit()
    finally:
        conn.close()

    return {
        "ok": True,
        "source_year": source_year,
        "rows_parsed": len(rows),
        "rows_with_business_number": matchable,
        "rows_skipped_no_business_number": len(rows) - matchable,
        "rows_inserted": inserted,
        "existing_corps_promoted_or_renewed": promoted,
    }


@router.get("/gov-corps-registry/years")
def list_years():
    """List years that have any rows in the registry, with counts."""
    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT source_year,
                      COUNT(*)                      AS row_count,
                      COUNT(business_number)        AS matchable_count,
                      MAX(imported_at)              AS last_imported_at
               FROM org_db.gov_corporations_registry
               GROUP BY source_year
               ORDER BY source_year DESC"""
        )
        rows = cur.fetchall()
        for r in rows:
            if hasattr(r.get("last_imported_at"), "isoformat"):
                r["last_imported_at"] = r["last_imported_at"].isoformat()
        return {"years": rows}
    finally:
        conn.close()


@router.get("/gov-corps-registry/{year}")
def preview_year(year: int):
    """Return all rows for a given year — used by the admin UI to
    inspect what was parsed."""
    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT * FROM org_db.gov_corporations_registry
               WHERE source_year = %s
               ORDER BY serial_no""",
            (year,),
        )
        rows = cur.fetchall()
        for r in rows:
            if hasattr(r.get("imported_at"), "isoformat"):
                r["imported_at"] = r["imported_at"].isoformat()
        return {"year": year, "rows": rows}
    finally:
        conn.close()
