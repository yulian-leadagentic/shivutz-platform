from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, EmailStr
from typing import List, Optional
from datetime import datetime, timedelta
import uuid, httpx, os

from app.db import get_db
from app.publisher import publish_event

router = APIRouter()

AUTH_SERVICE = os.getenv("AUTH_SERVICE_URL", "http://auth:3001")

class ContractorCreate(BaseModel):
    company_name: str
    company_name_he: str
    business_number: str
    classification: str
    operating_regions: List[str]
    contact_name: str
    contact_phone: str
    contact_email: EmailStr
    password: str  # owner account password


@router.post("", status_code=201)
async def register_contractor(data: ContractorCreate):
    org_id = str(uuid.uuid4())
    sla_deadline = datetime.utcnow() + timedelta(hours=48)

    conn = get_db()
    try:
        cur = conn.cursor(dictionary=True)

        # Create org record
        cur.execute(
            """INSERT INTO contractors
               (id, user_owner_id, company_name, company_name_he, business_number,
                classification, operating_regions, contact_name, contact_phone,
                contact_email, approval_sla_deadline)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (org_id, "PENDING", data.company_name, data.company_name_he,
             data.business_number, data.classification,
             str(data.operating_regions), data.contact_name,
             data.contact_phone, data.contact_email, sla_deadline)
        )

        # Register owner user in auth service
        async with httpx.AsyncClient() as client:
            resp = await client.post(f"{AUTH_SERVICE}/auth/register", json={
                "email": data.contact_email,
                "password": data.password,
                "role": "contractor",
                "org_id": org_id,
                "org_type": "contractor"
            })
            if resp.status_code == 409:
                conn.rollback()
                raise HTTPException(status_code=409, detail="Email already registered")
            resp.raise_for_status()
            user = resp.json()

        # Update user_owner_id now that we have it
        cur.execute("UPDATE contractors SET user_owner_id = %s WHERE id = %s", (user["id"], org_id))

        # Insert into org_users
        cur.execute(
            "INSERT INTO org_users (id, user_id, org_id, org_type, role, joined_at) VALUES (%s,%s,%s,%s,%s,NOW())",
            (str(uuid.uuid4()), user["id"], org_id, "contractor", "owner")
        )

        conn.commit()

        await publish_event("org.registered", {
            "org_id": org_id,
            "org_name": data.company_name,
            "org_type": "contractor"
        })

        return {"id": org_id, "status": "pending", "message": "Registration submitted. Awaiting admin approval (up to 48h)."}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@router.get("/{org_id}")
def get_contractor(org_id: str):
    conn = get_db()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT * FROM contractors WHERE id = %s AND deleted_at IS NULL", (org_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Contractor not found")
        return row
    finally:
        conn.close()
