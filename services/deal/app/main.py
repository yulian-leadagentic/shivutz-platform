from fastapi import FastAPI
from app.routes import deals, messages, reports, commissions
from app.db import init_db

app = FastAPI(title="Shivutz Deal Service", version="1.0.0")

@app.on_event("startup")
async def startup():
    await init_db()

@app.get("/health")
def health():
    return {"status": "ok", "service": "deal"}

app.include_router(deals.router,       prefix="/deals",       tags=["deals"])
app.include_router(messages.router,    prefix="/deals",       tags=["messages"])
app.include_router(reports.router,     prefix="/deals",       tags=["reports"])
app.include_router(commissions.router, prefix="/commissions", tags=["commissions"])
