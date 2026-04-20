from fastapi import FastAPI, HTTPException
from app.routes import deals, messages, reports, commissions
from app.db import get_db, init_db

app = FastAPI(title="Shivutz Deal Service", version="1.0.0")

@app.on_event("startup")
async def startup():
    await init_db()

@app.get("/health")
def health():
    """Liveness — static OK, independent of dependencies."""
    return {"status": "ok", "service": "deal"}


@app.get("/readyz")
def readyz():
    """Readiness — 503 if the deal DB can't serve a trivial query."""
    try:
        conn = get_db()
        try:
            cur = conn.cursor()
            cur.execute("SELECT 1")
            cur.fetchone()
        finally:
            conn.close()
        return {"status": "ready", "service": "deal"}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"db_unreachable: {e}")

app.include_router(deals.router,       prefix="/deals",       tags=["deals"])
app.include_router(messages.router,    prefix="/deals",       tags=["messages"])
app.include_router(reports.router,     prefix="/deals",       tags=["reports"])
app.include_router(commissions.router, prefix="/commissions", tags=["commissions"])
