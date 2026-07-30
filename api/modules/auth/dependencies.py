import asyncpg
from fastapi import Header, HTTPException

from db import pg_pool
from .token import AUTH_MODE, InvalidToken, verify_token

_INSERT_USER = """
INSERT INTO users (auth_provider, provider_subject, username, email)
VALUES ($1, $2, $3, $4)
RETURNING *
"""

_MAX_USERNAME_TRIES = 20


async def get_or_create_user(identity) -> dict:
    provider = "fake" if AUTH_MODE == "fake" else "supabase"
    subject = identity.subject
    email = identity.email

    pool = pg_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM users WHERE auth_provider = $1 AND provider_subject = $2",
            provider, subject,
        )
        if row:
            return dict(row)

        # The email prefix is only a suggestion — two people at different
        # providers can both be "alice". Suffix until one is free.
        base = email.split("@")[0] if email else f"user_{subject[:8]}"
        for attempt in range(_MAX_USERNAME_TRIES):
            username = base if attempt == 0 else f"{base}{attempt + 1}"
            try:
                row = await conn.fetchrow(_INSERT_USER, provider, subject,
                                          username, email)
                return dict(row)
            except asyncpg.UniqueViolationError as e:
                constraint = getattr(e, "constraint_name", "") or str(e)
                if "provider_subject" in constraint:
                    # someone created this same identity concurrently
                    row = await conn.fetchrow(
                        "SELECT * FROM users WHERE auth_provider = $1 "
                        "AND provider_subject = $2", provider, subject,
                    )
                    if row:
                        return dict(row)
                    raise
                if "username" not in constraint:
                    raise           # a different constraint: do not swallow it
                continue            # username taken, try the next suffix

        raise HTTPException(500, f"no free username for {base!r}")
    
async def get_current_user(authorization: str = Header(...)) -> dict:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "missing bearer token")
    token = authorization.removeprefix("Bearer ")
    try:
        identity = verify_token(token)
    except InvalidToken:
        raise HTTPException(401, "invalid token")
    return await get_or_create_user(identity)