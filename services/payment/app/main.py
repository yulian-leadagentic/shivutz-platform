from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from app.db import get_db, init_db
from app.errors import register_error_handlers
from app.routes import payment_methods, transactions, webhooks, admin_payments, settings

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from app.services.auto_charge import (
    # Pattern A (J5 pre-auth) — runs frequently so grace expiry resolves within ~1 min.
    process_expired_auths,
    process_failed_captures,
    # Pattern B (legacy token + scheduled charge) — kept working during transition.
    process_expired_grace_periods,
    process_retry_failed,
)

scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()

    # Pattern A sweeps (frequent — grace can be 24-48h so we want ~1-min resolution)
    scheduler.add_job(process_expired_auths,   "interval", minutes=1, id="capture_expired_auths")
    scheduler.add_job(process_failed_captures, "interval", minutes=5, id="capture_retry_failed")

    # Pattern B legacy sweeps (daily — same cadence as before)
    scheduler.add_job(process_expired_grace_periods, "cron", hour=2, minute=0, id="legacy_auto_charge")
    scheduler.add_job(process_retry_failed,          "cron", hour=3, minute=0, id="legacy_retry_failed")

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


# Gateway strips `/api` from every request before proxying (see
# services/gateway/src/index.js: pathRewrite). So /api/payments/foo arrives
# here as /payments/foo — every router under the payment service must be
# mounted with a /payments prefix.
# Exception: /webhooks, which Cardcom POSTs directly to and the gateway
# routes via /api/webhooks → /webhooks.
app.include_router(settings.router,        prefix="/payments/settings",        tags=["settings"])
app.include_router(payment_methods.router, prefix="/payments/payment-methods", tags=["payment-methods"])
app.include_router(transactions.router,    prefix="/payments",                 tags=["transactions"])
app.include_router(webhooks.router,        prefix="/webhooks",                 tags=["webhooks"])
app.include_router(admin_payments.router,  prefix="/payments/admin",           tags=["admin"])
