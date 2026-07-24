import os

import asyncpg
import redis.asyncio as redis
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]
REDIS_URL = os.environ["REDIS_URL"]

_pg_pool: asyncpg.Pool | None = None
_redis: redis.Redis | None = None


async def connect() -> None:
    global _pg_pool, _redis
    _pg_pool = await asyncpg.create_pool(DATABASE_URL)
    _redis = redis.from_url(REDIS_URL)
    await _redis.ping()


async def disconnect() -> None:
    if _pg_pool is not None:
        await _pg_pool.close()
    if _redis is not None:
        await _redis.aclose()


def pg_pool() -> asyncpg.Pool:
    assert _pg_pool is not None, "call connect() during app startup first"
    return _pg_pool


def redis_client() -> redis.Redis:
    assert _redis is not None, "call connect() during app startup first"
    return _redis
