import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from app.routes import contractors, corporations, users, admin_approvals, marketplace
from app.db import init_db

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/app/uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

app = FastAPI(title="Shivutz User-Org Service", version="1.0.0")

@app.on_event("startup")
async def startup():
    await init_db()

@app.get("/health")
def health():
    return {"status": "ok", "service": "user-org"}

# Serve uploaded files statically
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

app.include_router(contractors.router, prefix="/organizations/contractors", tags=["contractors"])
app.include_router(corporations.router, prefix="/organizations/corporations", tags=["corporations"])
app.include_router(users.router, prefix="/users", tags=["users"])
app.include_router(admin_approvals.router, prefix="/admin", tags=["admin"])
app.include_router(marketplace.router, prefix="/marketplace", tags=["marketplace"])
