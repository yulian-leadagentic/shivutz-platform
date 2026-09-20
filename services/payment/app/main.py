import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from app.db import get_db, init_db
from app.errors import register_error_handlers
from app.routes import payment_methods, webhooks, settings, subscriptions
# L5 §3 — read fake-mode state from the same module that gates Cardcom
# network calls, so the startup log tells the operator exactly what
# the payment service is doing with real money.
from app.services.cardcom import PAYMENT_FAKE_MODE
# L8 §1 — JSON error logger, Sentry alternative.
os.environ.setdefault("SERVICE_NAME", "payment")
from app.logging_config import configure_logging  # noqa: E402
configure_logging(level=os.getenv("LOG_LEVEL", "INFO"))

from apscheduler.schedulers.asyncio import AsyncIOScheduler

logger = logging.getLogger(__name__)

# D4: no scheduled jobs at present. The old capture-cron module was
# deleted with the deal-lifecycle sunset — it swept J5 pre-auths
# against the dropped `deals` table. Subscription renewals run via
# Cardcom's recurring engine over webhooks (see
# services/payment/app/routes/webhooks.py), not via APScheduler.

scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # L5 §3 — one visible line per boot that answers "is real money on
    # the line right now?". Without it the payment service silently ran
    # for weeks in fake mode because the old subscriptions fake flag
    # defaulted ON — the exact S2 category of bug the spec calls out.
    mode = "fake" if PAYMENT_FAKE_MODE else "real"
    reason = ("PAYMENT_FAKE_MODE=1" if PAYMENT_FAKE_MODE
              else "PAYMENT_FAKE_MODE unset or 0")
    logger.warning("[payment] mode=%s reason=%s", mode, reason)
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


# R19 §2b · reflect FREE_LAUNCH_UNTIL so the consistency suite can
# compare against the three other holders (site_settings.
# launch_promo_end · notification's env · frontend's NEXT_PUBLIC_*).
# The value is the ONLY field returned — no secrets. `null` = env
# var unset, which is itself a legitimate answer and one that fails
# the consistency check per §2b's "missing = failure, not skip"
# rule. This is the same value cardcom.py reads at startup, echoed
# verbatim so a mismatched suite tells us "payment says X, notification
# says Y" without needing to inspect Railway.
@app.get("/config/promo")
def config_promo():
    from app.services.cardcom import FREE_LAUNCH_UNTIL
    return {
        "service":           "payment",
        "free_launch_until": FREE_LAUNCH_UNTIL,
    }


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
