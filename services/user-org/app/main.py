import os
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from app.routes import contractors, corporations, users, admin_approvals, marketplace
from app.db import get_db, init_db

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/app/uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

app = FastAPI(title="Shivutz User-Org Service", version="1.0.0")

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

# Serve uploaded files statically
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

app.include_router(contractors.router, prefix="/organizations/contractors", tags=["contractors"])
app.include_router(corporations.router, prefix="/organizations/corporations", tags=["corporations"])
app.include_router(users.router, prefix="/users", tags=["users"])
app.include_router(admin_approvals.router, prefix="/admin", tags=["admin"])
app.include_router(marketplace.router, prefix="/marketplace", tags=["marketplace"])
