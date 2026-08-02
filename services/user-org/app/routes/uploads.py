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

from fastapi import APIRouter, HTTPException

router = APIRouter()

UPLOAD_FOLDER = os.getenv("CLOUDINARY_UPLOAD_FOLDER", "tagidai/ads")


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
