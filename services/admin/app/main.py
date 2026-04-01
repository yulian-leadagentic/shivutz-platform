from fastapi import FastAPI
from app.routes import dashboard, enums, approvals
from app.db import init_db

app = FastAPI(title="Shivutz Admin Service", version="1.0.0")

@app.on_event("startup")
async def startup():
    await init_db()

@app.get("/health")
def health():
    return {"status": "ok", "service": "admin"}

app.include_router(dashboard.router,   prefix="/admin", tags=["dashboard"])
app.include_router(approvals.router,   prefix="/admin", tags=["approvals"])
app.include_router(enums.router,       prefix="/enums",  tags=["enums"])
