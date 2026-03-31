from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import uuid, json

from app.db import get_db
from app.publisher import publish_event

router = APIRouter()


class MessageCreate(BaseModel):
    sender_user_id: str
    sender_role: str
    content: str


@router.post("/{deal_id}/messages", status_code=201)
async def send_message(deal_id: str, data: MessageCreate):
    msg_id = str(uuid.uuid4())
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO messages (id, deal_id, sender_user_id, sender_role, content) VALUES (%s,%s,%s,%s,%s)",
            (msg_id, deal_id, data.sender_user_id, data.sender_role, data.content)
        )
        conn.commit()

        await publish_event("message.new", {
            "deal_id": deal_id,
            "sender_user_id": data.sender_user_id,
            "sender_role": data.sender_role,
        })

        return {"id": msg_id}
    finally:
        conn.close()


@router.get("/{deal_id}/messages")
def get_messages(deal_id: str):
    conn = get_db()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute(
            "SELECT * FROM messages WHERE deal_id=%s AND deleted_at IS NULL ORDER BY created_at ASC",
            (deal_id,)
        )
        return cur.fetchall()
    finally:
        conn.close()
