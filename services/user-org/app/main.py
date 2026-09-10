import os
from fastapi import FastAPI, HTTPException
from app.routes import contractors, corporations, users, admin_approvals, marketplace, marketplace_admin, marketplace_subscriptions, marketplace_uploads, support, membership_requests, uploads, ads, search
from app.db import get_db, init_db
from app.errors import register_error_handlers

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/app/uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

app = FastAPI(title="Shivutz User-Org Service", version="1.0.0")
register_error_handlers(app)

@app.on_event("startup")
async def startup():
    await init_db()

@app.get("/health")
def health():
    """Liveness — static OK, independent of dependencies."""
    return {"status": "ok", "service": "user-org"}


@app.get("/readyz")
def readyz():
    """Readiness — 503 if the org DB can't serve a trivial query."""
    try:
        conn = get_db()
        try:
            cur = conn.cursor()
            cur.execute("SELECT 1")
            cur.fetchone()
        finally:
            conn.close()
        return {"status": "ready", "service": "user-org"}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"db_unreachable: {e}")

# L1 §2 · SEC-2 — the /uploads router now holds BOTH the Cloudinary
# signature endpoint and the gated file-streaming handler (see
# routes/uploads.py:get_uploaded_file). The unauthenticated
# `StaticFiles(directory=UPLOAD_DIR)` mount that used to sit here is
# gone — it served every file in the upload dir to anyone with the
# URL, and the gateway had it on PUBLIC_PREFIXES to let anonymous
# `<a href>` previews work. All files on that path are private tenant
# documents (business licences, IDs) — Cloudinary hosts logos /
# avatars / marketplace photos, so removing the mount is safe.
app.include_router(uploads.router, prefix="/uploads", tags=["uploads"])

app.include_router(contractors.router, prefix="/organizations/contractors", tags=["contractors"])
app.include_router(corporations.router, prefix="/organizations/corporations", tags=["corporations"])
app.include_router(users.router, prefix="/users", tags=["users"])
app.include_router(admin_approvals.router, prefix="/admin", tags=["admin"])
app.include_router(marketplace.router, prefix="/marketplace", tags=["marketplace"])
app.include_router(marketplace_admin.router, prefix="/marketplace/admin", tags=["marketplace-admin"])
app.include_router(marketplace_subscriptions.router, prefix="/marketplace", tags=["marketplace-subscriptions"])
app.include_router(marketplace_uploads.router, prefix="/marketplace/uploads", tags=["marketplace-uploads"])
app.include_router(support.router, prefix="/support-tickets", tags=["support"])
app.include_router(membership_requests.router, prefix="", tags=["membership-requests"])
app.include_router(ads.router, prefix="/ads", tags=["ads"])
app.include_router(search.router, prefix="/search", tags=["search"])
# deploy probe — 2026-05-29 (boot runs migrations 031 + 032 on staging)
