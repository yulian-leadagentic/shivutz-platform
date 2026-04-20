from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from app.db import get_db, init_db
from app.errors import register_error_handlers
from app.routes import payment_methods, transactions, webhooks, admin_payments, settings

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from app.services.auto_charge import process_expired_grace_periods, process_retry_failed

scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # Daily cron jobs
    scheduler.add_job(process_expired_grace_periods, "cron", hour=2,  minute=0, id="auto_charge")
    scheduler.add_job(process_retry_failed,           "cron", hour=3,  minute=0, id="retry_failed")
    scheduler.start()
    yield
    scheduler.shutdown()


app = FastAPI(
    title="Shivutz Payment Service",
    version="1.0.0",
    lifespan=lifespan,
)
register_error_handlers(app)


@app.get("/health")
def health():
    """Liveness — static OK, independent of dependencies."""
    return {"status": "ok", "service": "payment"}


@app.get("/readyz")
def readyz():
    """Readiness — 503 if the DB pool can't serve a trivial query."""
    try:
        conn = get_db()
        try:
            cur = conn.cursor()
            cur.execute("SELECT 1")
            cur.fetchone()
        finally:
            conn.close()
        return {"status": "ready", "service": "payment"}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"db_unreachable: {e}")


app.include_router(settings.router,        prefix="/settings",        tags=["settings"])
app.include_router(payment_methods.router, prefix="/payment-methods", tags=["payment-methods"])
app.include_router(transactions.router,    prefix="",                 tags=["transactions"])
app.include_router(webhooks.router,        prefix="/webhooks",        tags=["webhooks"])
app.include_router(admin_payments.router,  prefix="/admin",           tags=["admin"])
