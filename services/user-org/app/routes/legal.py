"""L10 · public read of legal_documents + site_settings.

Two endpoints, both PUBLIC. The Hebrew law requires that terms and
privacy be reachable without a login — L2 §2 closed /api/search, it
does NOT close /legal. Gateway PUBLIC_PREFIXES must include /api/legal.

Response shape:
  GET /legal/{slug}      → {slug, title_he, body_md, effective_at,
                            is_draft, version, updated_at}
  GET /legal/settings    → {setting_key: setting_val, ...}

is_draft is exposed so the frontend can render the "טיוטה" banner
without a second call. body_md is raw Markdown; the frontend passes
it through markdown-it (html:false) + DOMPurify — two-layer XSS
defence, spec §5.
"""
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException

from app.db import get_db

logger = logging.getLogger(__name__)
router = APIRouter()

_ALLOWED_SLUGS = {"terms", "privacy", "accessibility"}


def _iso(v):
    if v is None:
        return None
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return str(v)


@router.get("/legal/settings")
def get_site_settings():
    """Return every site_settings row as a flat {key: val} object.

    Never includes secrets — this table is UI-facing (company name,
    coordinator info); if a real secret ever lands here that's a
    separate bug, not something this endpoint should scrub after the
    fact.
    """
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT setting_key, setting_val FROM site_settings")
        rows = cur.fetchall()
    finally:
        conn.close()
    return {r["setting_key"]: r.get("setting_val") for r in rows}


@router.get("/legal/{slug}")
def get_legal_document(slug: str):
    if slug not in _ALLOWED_SLUGS:
        raise HTTPException(status_code=404, detail={"code": "unknown_slug"})
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT slug, title_he, body_md, version, effective_at,
                      is_draft, updated_at
                 FROM legal_documents WHERE slug=%s LIMIT 1""",
            (slug,),
        )
        row = cur.fetchone()
    finally:
        conn.close()
    if not row:
        # 404 is the correct signal — the frontend falls back to the
        # docs/*.md file (see §2 resolver in the page). NEVER auto-
        # insert a row here; the fallback is on purpose.
        raise HTTPException(status_code=404, detail={"code": "not_seeded"})
    return {
        "slug":         row["slug"],
        "title_he":     row["title_he"],
        "body_md":      row["body_md"],
        "version":      row["version"],
        "effective_at": _iso(row.get("effective_at")),
        "is_draft":     bool(row["is_draft"]),
        "updated_at":   _iso(row["updated_at"]),
    }
