import logging
from datetime import datetime

from db import pg_pool
from modules.leaderboard import record_match

from .glicko2 import DRAW, LOSS, WIN, Rating, update_duel

log = logging.getLogger("mathduel.ratings")

_UPSERT_RATING = """
    INSERT INTO ratings (user_id, tier, rating, rd, volatility, games_played, updated_at)
    VALUES ($1, $2, $3, $4, $5, 1, NOW())
    ON CONFLICT (user_id, tier) DO UPDATE SET
        rating          = EXCLUDED.rating,
        rd              = EXCLUDED.rd,
        volatility      = EXCLUDED.volatility,
        games_played    = ratings.games_played + 1,
        updated_at      = now()
"""

_INSERT_HISTORY = """
INSERT INTO rating_history
    (user_id, match_id, tier, rating_before, rating_after, rd_after)
VALUES ($1, $2, $3, $4, $5, $6)
"""

_INSERT_MATCH = """
INSERT INTO matches
    (id, tier, seed, tier_config_version, p1, p2, p2_is_bot,
     winner, p1_score, p2_score, status, started_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'rated', $11)
"""

async def _load_rating(conn, user_id: str, tier: str) -> Rating:
    row = await conn.fetchrow(
        "SELECT rating, rd, volatility FROM ratings WHERE user_id = $1 AND tier = $2",
        user_id, tier,
    )
    if row is None:
        return Rating()
    return Rating(row["rating"], row["rd"], row["volatility"])

async def finalize_match(
    *,
    match_id: str,
    tier: str,
    seed: int,
    p1: str,
    p2: str,
    p1_score: int,
    p2_score: int,
    winner: str | None,
    started_at: datetime | None = None,
    tier_config_version: int = 1,
    p2_is_bot: bool = False,
    _crash_after_match_insert: bool = False,   # test-only, proves rollback
) -> dict:
    """Write the match and both players' rating changes atomically."""
    if winner is None:
        s1 = s2 = DRAW
    elif winner == p1:
        s1, s2 = WIN, LOSS
    elif winner == p2:
        s1, s2 = LOSS, WIN
    else:
        raise ValueError(f"winner {winner!r} is not a player in this match")
    
    pool = pg_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            before1 = await _load_rating(conn, p1, tier)
            before2 = await _load_rating(conn, p2, tier)
            
            after1 = update_duel(before1, before2, s1)
            after2 = update_duel(before2, before1, s2)
            
            await conn.execute(_INSERT_MATCH, match_id, tier, seed,
                               tier_config_version, p1, p2, p2_is_bot,
                               winner, p1_score, p2_score, started_at)
            
            if _crash_after_match_insert:
                raise RuntimeError("deliberate crash after match insert")
            
            await conn.execute(_UPSERT_RATING, p1, tier, 
                               after1.rating, after1.rd, after1.volatility)
            await conn.execute(_UPSERT_RATING, p2, tier,
                               after2.rating, after2.rd, after2.volatility)
            
            await conn.execute(_INSERT_HISTORY, p1, match_id, tier,
                               before1.rating, after1.rating, after1.rd)
            
            await conn.execute(_INSERT_HISTORY, p2, match_id, tier,
                               before2.rating, after2.rating, after2.rd)

    # The board is a derived hot view, so it lives OUTSIDE the transaction:
    # Redis cannot be rolled back alongside Postgres. If this fails the ladder
    # is still correct and the board rebuilds from the match record.
    try:
        await record_match(p1, p2, winner, tier)
    except Exception as e:                              # noqa: BLE001
        log.warning("leaderboard update failed for %s: %s", match_id, e)

    return {
        "match_id": match_id,
        p1: {"before": before1.rating, "after": after1.rating,
             "delta": after1.rating - before1.rating, "rd": after1.rd},
        p2: {"before": before2.rating, "after": after2.rating,
             "delta": after2.rating - before2.rating, "rd": after2.rd},
    }