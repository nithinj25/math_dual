import asyncio
import json
import logging
import os
import time

from aiokafka import AIOKafkaProducer

log = logging.getLogger("mathduel.events")

TOPIC_ANSWERS = "game.answers"
TOPIC_MATCHES = "game.matches"

BOOTSTRAP = os.environ.get("KAFKA_BOOTSTRAP", "127.0.0.1:9092")

_producer: AIOKafkaProducer | None = None
_dropped = 0

async def start() -> None:
    """kafka being down must never stop the game from starting"""
    global _producer
    try:
        p = AIOKafkaProducer(
            bootstrap_servers=BOOTSTRAP,
            value_serializer=lambda v: json.dumps(v).encode(),
            key_serializer=lambda k: k.encode(),
            acks=1,                      # leader only: analytics, not money
            linger_ms=20,                # small batching window
            max_request_size=1_000_000,
        )
        await p.start()
        _producer = p
        log.info("connected: kafka at %s", BOOTSTRAP)

    except Exception as e:
        _producer = None
        log.warning("kafka unavailable (%s) - events will be dropped", e)
        
async def stop() -> None:
    global _producer
    if _producer is not None:
        await _producer.stop()
        _producer = None
    if _dropped:
        log.warning("dropped %d events this run", _dropped)
        
async def _deliver(topic: str, key: str, event: dict) -> None:
    global _dropped
    try:
        await _producer.send(topic, key=key, value=event)
    except Exception as e:
        _dropped += 1                                             
        log.debug("kafka send failed: %s", e)
        
        
def emit(topic: str, key: str, kind: str, payload: dict) -> None:
    """Fire and forget. Deliberately NOT async — the caller never waits,
    so a Kafka stall can never become a player's stall."""
    if _producer is None:
        return
    event = {"kind": kind, "ts": time.time(), **payload}
    asyncio.create_task(_deliver(topic, key, event))
        