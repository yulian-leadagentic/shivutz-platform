"""L10 · admin CRUD for legal_documents + site_settings.

Every write is auth-gated by the gateway (/api/admin/* → role=admin
per gateway/src/index.js:203,274). This module trusts that layer and
does NOT re-check the role — services/admin has no auth of its own
by design (spec §5.2).

On every save the previous body is copied to legal_document_history
and version is incremented. History is read-only in this round; no
restore endpoint (spec §4.1: 'without restore in this round').
"""
import logging
import uuid
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

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


def _serialize_doc(row: dict) -> dict:
    return {
        "slug":         row["slug"],
        "title_he":     row["title_he"],
        "body_md":      row["body_md"],
        "version":      row["version"],
        "effective_at": _iso(row.get("effective_at")),
        "is_draft":     bool(row["is_draft"]),
        "updated_at":   _iso(row["updated_at"]),
        "updated_by":   row.get("updated_by"),
    }


# ─── legal_documents ────────────────────────────────────────────────

@router.get("/legal/documents")
def list_documents():
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT slug, title_he, body_md, version, effective_at,
                      is_draft, updated_at, updated_by
                 FROM legal_documents
                ORDER BY FIELD(slug, 'terms','privacy','accessibility')"""
        )
        return [_serialize_doc(r) for r in cur.fetchall()]
    finally:
        conn.close()


@router.get("/legal/documents/{slug}")
def get_document(slug: str):
    if slug not in _ALLOWED_SLUGS:
        raise HTTPException(status_code=404, detail={"code": "unknown_slug"})
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT slug, title_he, body_md, version, effective_at,
                      is_draft, updated_at, updated_by
                 FROM legal_documents WHERE slug=%s""",
            (slug,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail={"code": "not_found"})
        return _serialize_doc(row)
    finally:
        conn.close()


@router.get("/legal/documents/{slug}/history")
def list_document_history(slug: str):
    if slug not in _ALLOWED_SLUGS:
        raise HTTPException(status_code=404, detail={"code": "unknown_slug"})
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT id, slug, version, body_md, replaced_at, replaced_by
                 FROM legal_document_history
                WHERE slug=%s
                ORDER BY version DESC""",
            (slug,),
        )
        return [{
            "id":          r["id"],
            "slug":        r["slug"],
            "version":     r["version"],
            "body_md":     r["body_md"],
            "replaced_at": _iso(r["replaced_at"]),
            "replaced_by": r.get("replaced_by"),
        } for r in cur.fetchall()]
    finally:
        conn.close()


class DocumentPatch(BaseModel):
    title_he:     Optional[str]  = Field(default=None, max_length=200)
    body_md:      Optional[str]  = None
    effective_at: Optional[date] = None
    is_draft:     Optional[bool] = None


@router.patch("/legal/documents/{slug}")
def update_document(
    slug: str,
    body: DocumentPatch,
    x_user_id: Optional[str] = Header(default=None),
):
    if slug not in _ALLOWED_SLUGS:
        raise HTTPException(status_code=404, detail={"code": "unknown_slug"})
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail={"code": "no_changes"})

    conn = get_db()
    try:
        cur = conn.cursor()
        # Fetch current row for history + version bump.
        cur.execute(
            "SELECT version, body_md FROM legal_documents WHERE slug=%s FOR UPDATE",
            (slug,),
        )
        current = cur.fetchone()
        if not current:
            raise HTTPException(status_code=404, detail={"code": "not_found"})

        # History: only write if body_md is changing. Title / date /
        # draft-flag edits don't warrant a new legal version.
        body_changing = "body_md" in data and data["body_md"] != current["body_md"]
        next_version = current["version"] + 1 if body_changing else current["version"]

        if body_changing:
            hist_id = str(uuid.uuid4())
            cur.execute(
                """INSERT INTO legal_document_history
                     (id, slug, version, body_md, replaced_by)
                   VALUES (%s, %s, %s, %s, %s)""",
                (hist_id, slug, current["version"], current["body_md"], x_user_id),
            )

        sets = []
        params: list = []
        for col in ("title_he", "body_md", "effective_at", "is_draft"):
            if col in data:
                sets.append(f"{col}=%s")
                params.append(data[col])
        if body_changing:
            sets.append("version=%s")
            params.append(next_version)
        sets.append("updated_by=%s")
        params.append(x_user_id)
        params.append(slug)

        cur.execute(
            f"UPDATE legal_documents SET {', '.join(sets)} WHERE slug=%s",
            params,
        )
        conn.commit()

        cur.execute(
            """SELECT slug, title_he, body_md, version, effective_at,
                      is_draft, updated_at, updated_by
                 FROM legal_documents WHERE slug=%s""",
            (slug,),
        )
        return _serialize_doc(cur.fetchone())
    finally:
        conn.close()


# ─── site_settings ──────────────────────────────────────────────────

@router.get("/legal/settings")
def list_settings():
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT setting_key, setting_val, label_he, updated_at
                 FROM site_settings ORDER BY setting_key"""
        )
        return [{
            "setting_key": r["setting_key"],
            "setting_val": r.get("setting_val"),
            "label_he":    r["label_he"],
            "updated_at":  _iso(r["updated_at"]),
        } for r in cur.fetchall()]
    finally:
        conn.close()


class SettingPatch(BaseModel):
    setting_val: Optional[str] = Field(default=None, max_length=500)


@router.patch("/legal/settings/{setting_key}")
def update_setting(setting_key: str, body: SettingPatch):
    # setting_val explicitly nullable — "" or omitted comes through as
    # None and is stored as NULL (spec §4.2: empty saves as NULL).
    val = body.setting_val
    if isinstance(val, str) and val.strip() == "":
        val = None

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE site_settings SET setting_val=%s WHERE setting_key=%s",
            (val, setting_key),
        )
        if cur.rowcount == 0:
            # We do NOT auto-create rows — spec seeds the seven known
            # keys, and anything else is a typo not a new feature.
            raise HTTPException(status_code=404, detail={"code": "unknown_setting_key"})
        conn.commit()
        cur.execute(
            """SELECT setting_key, setting_val, label_he, updated_at
                 FROM site_settings WHERE setting_key=%s""",
            (setting_key,),
        )
        r = cur.fetchone()
        return {
            "setting_key": r["setting_key"],
            "setting_val": r.get("setting_val"),
            "label_he":    r["label_he"],
            "updated_at":  _iso(r["updated_at"]),
        }
    finally:
        conn.close()
