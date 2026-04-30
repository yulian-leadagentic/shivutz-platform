"""Marketplace event publisher.

Mirrors services/user-org/app/publisher.py exactly: same exchange,
same connection pattern, same fire-and-forget semantics. The matching
notification flow listens on `worker.changed`.
"""
import aio_pika, os, json

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672")
EXCHANGE_NAME = "marketplace.events"


async def publish_event(routing_key: str, payload: dict):
    try:
        conn = await aio_pika.connect_robust(RABBITMQ_URL)
        async with conn:
            channel = await conn.channel()
            exchange = await channel.declare_exchange(
                EXCHANGE_NAME, aio_pika.ExchangeType.TOPIC, durable=True
            )
            await exchange.publish(
                aio_pika.Message(
                    body=json.dumps(payload).encode(),
                    content_type="application/json",
                    delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                ),
                routing_key=routing_key,
            )
    except Exception as e:
        print(f"[publisher] Failed to publish {routing_key}: {e}")
