from fastapi import FastAPI
from app.routes import workers, enums, availability
from app.db import init_db

app = FastAPI(title="Shivutz Worker Service", version="1.0.0")

@app.on_event("startup")
async def startup():
    await init_db()

@app.get("/health")
def health():
    return {"status": "ok", "service": "worker"}

app.include_router(workers.router,      prefix="/workers",      tags=["workers"])
app.include_router(enums.router,        prefix="/enums",        tags=["enums"])
app.include_router(availability.router, prefix="/workers",      tags=["availability"])
