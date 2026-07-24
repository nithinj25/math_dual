from fastapi import Header, HTTPException

from db import pg_pool
from .token import AUTH_MODE, InvalidToken, verify_token


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

        username = email.split("@")[0] if email else f"user_{subject[:8]}"
        row = await conn.fetchrow(
            """
            INSERT INTO users (auth_provider, provider_subject, username, email)
            VALUES ($1, $2, $3, $4)
            RETURNING *
            """,
            provider, subject, username, email,
        )
        return dict(row)
    
async def get_current_user(authorization: str = Header(...)) -> dict:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "missing bearer token")
    token = authorization.removeprefix("Bearer ")
    try:
        identity = verify_token(token)
    except InvalidToken:
        raise HTTPException(401, "invalid token")
    return await get_or_create_user(identity)