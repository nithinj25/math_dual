import logging
from datetime import datetime, timedelta, timezone

from db import pg_pool, redis_client

log = logging.getLogger("mathduel.leaderboard")

# Ladder points. DESIGN.md says "ladder points" but not the scheme —
# this is our call: a win is worth a draw plus two.
WIN_POINTS = 3.0
DRAW_POINTS = 1.0
LOSS_POINTS = 0.0


def _s(v) -> str:
    return v.decode() if isinstance(v, bytes) else v


def iso_week(when: datetime | None = None) -> str:
    year, week, _ = (when or datetime.now(timezone.utc)).isocalendar()
    return f"{year}-W{week:02d}"


def global_key(tier: str) -> str:
    return f"lb:global:{tier}"


def weekly_key(tier: str, week: str | None = None) -> str:
    return f"lb:weekly:{week or iso_week()}:{tier}"


def _weekly_ttl_seconds(now: datetime | None = None) -> int:
    """Expire at end of this ISO week plus 7 days, per DESIGN.md 4.2."""
    now = now or datetime.now(timezone.utc)
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    next_monday = midnight + timedelta(days=8 - now.isoweekday())
    return max(60, int((next_monday + timedelta(days=7) - now).total_seconds()))


async def award(user_id: str, tier: str, points: float) -> None:
    """ZINCRBY both boards. Zero points still registers membership, so a
    player who only ever loses still appears on the board."""
    r = redis_client()
    wk = weekly_key(tier)
    pipe = r.pipeline()
    pipe.zincrby(global_key(tier), points, user_id)
    pipe.zincrby(wk, points, user_id)
    pipe.expire(wk, _weekly_ttl_seconds())
    await pipe.execute()


async def record_match(p1: str, p2: str, winner: str | None, tier: str) -> None:
    if winner is None:
        await award(p1, tier, DRAW_POINTS)
        await award(p2, tier, DRAW_POINTS)
    else:
        loser = p2 if winner == p1 else p1
        await award(winner, tier, WIN_POINTS)
        await award(loser, tier, LOSS_POINTS)


async def top(tier: str, limit: int = 50, weekly: bool = False) -> list[dict]:
    r = redis_client()
    key = weekly_key(tier) if weekly else global_key(tier)
    rows = await r.zrevrange(key, 0, limit - 1, withscores=True)
    return [{"rank": i + 1, "user_id": _s(m), "points": s}
            for i, (m, s) in enumerate(rows)]


async def rank_of(user_id: str, tier: str, weekly: bool = False) -> dict | None:
    r = redis_client()
    key = weekly_key(tier) if weekly else global_key(tier)
    idx = await r.zrevrank(key, user_id)      # O(log n), not a scan
    if idx is None:
        return None
    points = await r.zscore(key, user_id)
    total = await r.zcard(key)
    return {"rank": idx + 1, "points": points, "of": total}


async def rebuild_from_postgres(tier: str) -> int:
    """Redis is disposable: recompute the global board from the match record."""
    pool = pg_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT user_id, SUM(points)::float8 AS points FROM (
                SELECT p1 AS user_id,
                       CASE WHEN winner = p1 THEN $2::float8
                            WHEN winner IS NULL THEN $3::float8
                            ELSE $4::float8 END AS points
                FROM matches WHERE tier = $1 AND status = 'rated'
                UNION ALL
                SELECT p2,
                       CASE WHEN winner = p2 THEN $2::float8
                            WHEN winner IS NULL THEN $3::float8
                            ELSE $4::float8 END
                FROM matches WHERE tier = $1 AND status = 'rated'
            ) x GROUP BY user_id
            """,
            tier, WIN_POINTS, DRAW_POINTS, LOSS_POINTS,
        )

    r = redis_client()
    key = global_key(tier)
    pipe = r.pipeline()
    pipe.delete(key)
    if rows:
        pipe.zadd(key, {str(row["user_id"]): row["points"] for row in rows})
    await pipe.execute()
    return len(rows)


async def snapshot(tier: str, weekly: bool = False) -> int:
    """The nightly job: bound Redis loss to one day of drift."""
    r = redis_client()
    scope = iso_week() if weekly else "global"
    key = weekly_key(tier) if weekly else global_key(tier)
    rows = await r.zrevrange(key, 0, -1, withscores=True)
    if not rows:
        return 0

    pool = pg_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.executemany(
                "INSERT INTO leaderboard_snapshots "
                "(tier, scope, user_id, points, rank) VALUES ($1,$2,$3,$4,$5)",
                [(tier, scope, _s(m), s, i + 1) for i, (m, s) in enumerate(rows)],
            )
    return len(rows)
