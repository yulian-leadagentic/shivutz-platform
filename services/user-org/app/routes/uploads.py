"""Pivot/v2 — signed Cloudinary upload params.

Frontend calls /uploads/cloudinary-signature to get a fresh set of
params it can hand to Cloudinary's upload API. Signing happens here so
CLOUDINARY_API_SECRET never leaves the server.

Cloudinary docs: https://cloudinary.com/documentation/upload_images#uploading_with_a_direct_call_to_the_api

Env vars required to activate:
  CLOUDINARY_CLOUD_NAME
  CLOUDINARY_API_KEY
  CLOUDINARY_API_SECRET

If any is missing, the endpoint returns 501 not_configured — the
frontend PhotoUploader falls back to a plain URL input.
"""
import hashlib
import os
import time
import mimetypes
from typing import Optional
from pathlib import Path

from fastapi import APIRouter, HTTPException, Header
from fastapi.responses import FileResponse

from app.db import get_db
from app.services.entity_access import require_entity_access

router = APIRouter()

UPLOAD_FOLDER = os.getenv("CLOUDINARY_UPLOAD_FOLDER", "tagidai/ads")
UPLOAD_DIR    = os.getenv("UPLOAD_DIR", "/app/uploads")


@router.get("/cloudinary-signature")
def cloudinary_signature():
    cloud   = os.getenv("CLOUDINARY_CLOUD_NAME")
    api_key = os.getenv("CLOUDINARY_API_KEY")
    secret  = os.getenv("CLOUDINARY_API_SECRET")

    if not cloud or not api_key or not secret:
        raise HTTPException(status_code=501, detail={"code": "not_configured"})

    timestamp = int(time.time())
    # Params to sign — must match exactly what the client submits (minus
    # file, api_key, signature). Sorted alphabetically per Cloudinary spec.
    params_to_sign = f"folder={UPLOAD_FOLDER}&timestamp={timestamp}"
    signature = hashlib.sha1((params_to_sign + secret).encode("utf-8")).hexdigest()

    return {
        "cloud_name": cloud,
        "api_key":    api_key,
        "timestamp":  timestamp,
        "signature":  signature,
        "folder":     UPLOAD_FOLDER,
        "upload_url": f"https://api.cloudinary.com/v1_1/{cloud}/image/upload",
    }


# ─── L1 §2 · SEC-2 · gated file streaming ─────────────────────────
#
# Previously served by an unauthenticated StaticFiles mount at /uploads
# in main.py. Every file on that path is a private tenant document
# saved to `auth_db.entity_documents` (business licence, ID scan, tax
# certs) by contractors.py:1058 and corporations.py:942 — logos,
# avatars, and marketplace photos live on Cloudinary and are
# unaffected.
#
# Auth chain:
#   1. Gateway now requires a JWT for /api/uploads/* (removed from
#      PUBLIC_PREFIXES in this same commit).
#   2. Handler looks up the entity_documents row by file_url and
#      hands entity_type + entity_id to require_entity_access.
#   3. Admins pass through (support tooling, admin doc previews).
#
# Follow-up (called out in the L1 report — not fixed here per the
# guardrail against widening the gateway to accept cookie auth):
# the contractor / corp / admin docs UIs that render
# `<a href="/api/uploads/…">` won't attach the Bearer token — a
# separate frontend patch must switch to fetch+blob for those
# download links.
@router.get("/{filename}")
def get_uploaded_file(
    filename: str,
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
    x_user_role:   Optional[str] = Header(default=None),
):
    # Path-traversal defense — filenames are server-generated UUIDs,
    # so anything with / or .. is a probe.
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=404, detail={"error": "file_not_found"})
    file_url = f"/api/uploads/{filename}"
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT entity_type, entity_id FROM auth_db.entity_documents WHERE file_url = %s LIMIT 1",
            (file_url,),
        )
        row = cur.fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail={"error": "file_not_found"})
    require_entity_access(
        x_entity_id, x_entity_type, x_user_role,
        row["entity_id"], row["entity_type"],
    )
    path = Path(UPLOAD_DIR) / filename
    if not path.is_file():
        # DB row exists but the file on disk is gone (retention job,
        # manual cleanup, cross-env restore mismatch). Treat as 404
        # rather than leaking the discrepancy.
        raise HTTPException(status_code=404, detail={"error": "file_not_found"})
    media_type, _ = mimetypes.guess_type(str(path))
    return FileResponse(str(path), media_type=media_type or "application/octet-stream")
