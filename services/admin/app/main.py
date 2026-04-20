from fastapi import FastAPI, HTTPException
from app.routes import dashboard, enums, approvals, commissions, pricing, registration_log
from app.db import get_db, init_db
from app.errors import register_error_handlers

app = FastAPI(title="Shivutz Admin Service", version="1.0.0")
register_error_handlers(app)

@app.on_event("startup")
async def startup():
    await init_db()

@app.get("/health")
def health():
    """Liveness — static OK, independent of dependencies."""
    return {"status": "ok", "service": "admin"}


@app.get("/readyz")
def readyz():
    """Readiness — 503 if any of the schemas admin reads from is unreachable."""
    try:
        conn = get_db("deal_db")
        try:
            cur = conn.cursor()
            cur.execute("SELECT 1")
            cur.fetchone()
        finally:
            conn.close()
        return {"status": "ready", "service": "admin"}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"db_unreachable: {e}")

app.include_router(dashboard.router,     prefix="/admin", tags=["dashboard"])
app.include_router(approvals.router,     prefix="/admin", tags=["approvals"])
app.include_router(commissions.router,   prefix="/admin", tags=["commissions"])
app.include_router(pricing.router,       prefix="/admin", tags=["pricing"])
app.include_router(enums.router,              prefix="/enums",  tags=["enums"])
app.include_router(registration_log.router,   prefix="",        tags=["registration-log"])
