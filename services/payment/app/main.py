from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from app.db import get_db, init_db
from app.errors import register_error_handlers
from app.routes import payment_methods, webhooks, settings, subscriptions

from apscheduler.schedulers.asyncio import AsyncIOScheduler

# D4: no scheduled jobs at present. The old capture-cron module was
# deleted with the deal-lifecycle sunset — it swept J5 pre-auths
# against the dropped `deals` table. Subscription renewals run via
# Cardcom's recurring engine over webhooks (see
# services/payment/app/routes/webhooks.py), not via APScheduler.

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
app.include_router(subscriptions.router,   prefix="/payments/subscriptions",   tags=["subscriptions"])
