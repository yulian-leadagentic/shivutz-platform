from fastapi import FastAPI
from app.routes import contractors, corporations, users, admin_approvals
from app.db import init_db

app = FastAPI(title="Shivutz User-Org Service", version="1.0.0")

@app.on_event("startup")
async def startup():
    await init_db()

@app.get("/health")
def health():
    return {"status": "ok", "service": "user-org"}

app.include_router(contractors.router, prefix="/organizations/contractors", tags=["contractors"])
app.include_router(corporations.router, prefix="/organizations/corporations", tags=["corporations"])
app.include_router(users.router, prefix="/users", tags=["users"])
app.include_router(admin_approvals.router, prefix="/admin", tags=["admin"])
