"""
Cloudinary signed-upload signature endpoint.

Browser flow:
  1. POST /marketplace/uploads/signature  → returns signed params
  2. Browser POSTs the file directly to Cloudinary with those params.
  3. Cloudinary returns a `secure_url`; frontend stashes it on the
     listing's images_json.

Cloudinary signing is just SHA1(params_to_sign + api_secret), where
params_to_sign is the alphabetised `key=value&...` of every UPLOAD
param the client will send (except `file`, `api_key`, `signature`,
`resource_type`, `cloud_name`). Doing this manually keeps us off the
`cloudinary` PyPI package — one less dependency, one less version
to keep current.

If the Cloudinary env vars aren't set we return 503 with a clear
"not configured" message rather than failing inside Cloudinary.
"""
import hashlib
import os
import time
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Header

router = APIRouter()

CLOUDINARY_CLOUD_NAME  = os.getenv("CLOUDINARY_CLOUD_NAME", "")
CLOUDINARY_API_KEY     = os.getenv("CLOUDINARY_API_KEY", "")
CLOUDINARY_API_SECRET  = os.getenv("CLOUDINARY_API_SECRET", "")
# All marketplace listing images live under this prefix in Cloudinary.
# Per-listing subfolders make orphan cleanup easier later.
CLOUDINARY_FOLDER_BASE = os.getenv("CLOUDINARY_FOLDER_BASE", "shivutz/marketplace")


def _is_configured() -> bool:
    return bool(CLOUDINARY_CLOUD_NAME and CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET)


def _sign(params: dict[str, str]) -> str:
    """Cloudinary upload signature: SHA1 of the alphabetised
    `key=value&...` of all signed params, with the api_secret tacked on
    the end. Empty values are skipped per Cloudinary's spec."""
    pairs = sorted(
        f"{k}={v}" for k, v in params.items()
        if v != "" and v is not None
    )
    raw = "&".join(pairs) + CLOUDINARY_API_SECRET
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


@router.post("/signature")
def get_upload_signature(
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
    x_org_id:      Optional[str] = Header(default=None),
):
    """Issue a signed upload set for the calling advertiser. The
    signature ties the upload to a per-advertiser folder so a leaked
    signature can't be used to overwrite someone else's images."""
    entity_id = x_entity_id or x_org_id
    entity_type = (x_entity_type or "").lower()
    if not entity_id or entity_type not in ("contractor", "corporation"):
        raise HTTPException(status_code=403, detail="advertiser_required")

    if not _is_configured():
        raise HTTPException(
            status_code=503,
            detail={
                "code": "cloudinary_not_configured",
                "message": "העלאת תמונות עדיין לא הופעלה בסביבה זו. פנה למנהל המערכת.",
            },
        )

    timestamp = int(time.time())
    folder    = f"{CLOUDINARY_FOLDER_BASE}/{entity_type}/{entity_id}"
    public_id = uuid.uuid4().hex  # uniqueness across uploads

    params_to_sign = {
        "folder":    folder,
        "public_id": public_id,
        "timestamp": str(timestamp),
    }
    signature = _sign(params_to_sign)

    return {
        "cloud_name": CLOUDINARY_CLOUD_NAME,
        "api_key":    CLOUDINARY_API_KEY,
        "timestamp":  timestamp,
        "folder":     folder,
        "public_id":  public_id,
        "signature":  signature,
        # The endpoint the browser POSTs to; included so the frontend
        # doesn't need to know the Cloudinary URL shape.
        "upload_url": f"https://api.cloudinary.com/v1_1/{CLOUDINARY_CLOUD_NAME}/image/upload",
    }
