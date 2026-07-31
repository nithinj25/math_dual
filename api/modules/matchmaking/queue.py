from db import pg_pool, redis_client

from .tiers import DEFAULT_RATING, select_tier

BASE_WINDOW = 50          # start at +/- 50 rating
WIDEN_PER_STEP = 50       # widen by 50...
WIDEN_EVERY_SECONDS = 3   # ...every 3 seconds of waiting
MAX_WINDOW = 1000

# One indivisible operation. Nothing can interleave between the search
# and the removal, so two callers can never claim the same opponent.
_PAIR_LUA = """
local queue  = KEYS[1]
local me     = ARGV[1]
local rating = tonumber(ARGV[2])
local window = tonumber(ARGV[3])

local found = redis.call('ZRANGEBYSCORE', queue,
                         rating - window, rating + window,
                         'WITHSCORES', 'LIMIT', 0, 10)

local best, bestDiff = nil, nil
for i = 1, #found, 2 do
    local member = found[i]
    local score  = tonumber(found[i + 1])
    if member ~= me then
        local diff = math.abs(score - rating)
        if bestDiff == nil or diff < bestDiff then
            best, bestDiff = member, diff
        end
    end
end

if best then
    redis.call('ZREM', queue, best, me)   -- both leave together
    return best
end

redis.call('ZADD', queue, rating, me)     -- nobody yet: wait here
return false
"""

_script = None


def _pair_script():
    global _script
    if _script is None:                       # registered lazily: needs a live client
        _script = redis_client().register_script(_PAIR_LUA)
    return _script


def queue_key(tier: str) -> str:
    return f"mm:queue:{tier}"


def window_for(waited_seconds: float) -> int:
    """Quality vs speed, made explicit. Narrow = fair but slow; wide = fast
    but mismatched. We favour speed: an app that feels empty dies."""
    steps = int(waited_seconds // WIDEN_EVERY_SECONDS)
    return min(BASE_WINDOW + steps * WIDEN_PER_STEP, MAX_WINDOW)


async def find_or_wait(user_id: str, tier: str, rating: float,
                       waited_seconds: float = 0.0) -> str | None:
    """Returns an opponent id, or None if we are now queued and waiting."""
    result = await _pair_script()(
        keys=[queue_key(tier)],
        args=[user_id, rating, window_for(waited_seconds)],
    )
    if not result:
        return None
    return result.decode() if isinstance(result, bytes) else result


async def leave(user_id: str, tier: str) -> int:
    return await redis_client().zrem(queue_key(tier), user_id)


async def size(tier: str) -> int:
    return await redis_client().zcard(queue_key(tier))


async def rating_and_tier(user_id: str) -> tuple[str, float]:
    """A player's tier follows their rating, not the other way round."""
    pool = pg_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT rating FROM ratings WHERE user_id = $1 "
            "ORDER BY games_played DESC LIMIT 1", user_id,
        )
    rating = float(row["rating"]) if row else float(DEFAULT_RATING)
    return select_tier(rating), rating
