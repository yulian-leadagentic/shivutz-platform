from fastapi import FastAPI, HTTPException
from app.routes import tenders
from app.db import get_db, init_db
from app.errors import register_error_handlers

app = FastAPI(title="Shivutz Tender Service", version="2.0.0")
register_error_handlers(app)

@app.on_event("startup")
async def startup():
    await init_db()

@app.get("/health")
def health():
    return {"status": "ok", "service": "tender"}


@app.get("/readyz")
def readyz():
    try:
        conn = get_db()
        try:
            cur = conn.cursor()
            cur.execute("SELECT 1")
            cur.fetchone()
        finally:
            conn.close()
        return {"status": "ready", "service": "tender"}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"db_unreachable: {e}")

app.include_router(tenders.router, prefix="/tenders", tags=["tenders"])
