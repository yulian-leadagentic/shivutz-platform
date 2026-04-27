from fastapi import APIRouter, HTTPException
from app.db import get_db

router = APIRouter()


@router.get("/organizations/{org_id}/users")
def list_org_users(org_id: str):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM org_users WHERE org_id = %s AND deleted_at IS NULL",
            (org_id,)
        )
        return cur.fetchall()
    finally:
        conn.close()
