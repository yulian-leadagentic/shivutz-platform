from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from app.db import get_db, init_db
from app.errors import register_error_handlers
from app.routes import payment_methods, webhooks, admin_payments, settings, subscriptions

from apscheduler.schedulers.asyncio import AsyncIOScheduler

# D4 step 0 — auto_charge cron unscheduled. All four jobs
# (process_expired_auths / process_failed_captures /
# process_expired_grace_periods / process_retry_failed) captured
# J5 pre-auths on the dropped `deals` table, so every tick has
# been erroring on staging since the deal-service sunset. The
# module + payment_transactions cleanup happens in later D4 steps
# once we confirm no live billing branch depends on the same
# storage.

scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # No scheduled jobs at present. Subscription renewals run via
    # Cardcom's recurring engine (Cardcom pushes webhooks), not
    # via APScheduler.
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
app.include_router(webhooks.router,        prefix="/webhooks",                 tags=["webhooks"])
app.include_router(admin_payments.router,  prefix="/payments/admin",           tags=["admin"])
app.include_router(subscriptions.router,   prefix="/payments/subscriptions",   tags=["subscriptions"])
