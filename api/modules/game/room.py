import json

from db import redis_client

ROOM_TTL_SECONDS = 600

def _s(v) -> str:
    return v.decode() if isinstance(v, bytes) else v

def room_key(match_id: str) -> str:
    return f"room:{match_id}"

def player_key(user_id: str) -> str:
    return f"player:{user_id}"

def channel(match_id: str) -> str:
    return f"match:{match_id}"

async def create_room(match_id: str, tier: str, seed: int,
                      player_ids: list[str])-> None:
    
    """everything a gateway needs to server this match without 
    having been that started it"""
    r = redis_client()
    pipe = r.pipeline()
    pipe.hset(room_key(match_id), mapping={
        "match_id": match_id,
        "tier": tier,
        "seed": str(seed),
        "players": json.dumps(player_ids),
        "status": "matched",
    })
    pipe.expire(room_key(match_id), ROOM_TTL_SECONDS)
    for pid in player_ids:                       # reverse index for reconnect
        pipe.set(player_key(pid), match_id, ex=ROOM_TTL_SECONDS)
    await pipe.execute()
    
async def get_room(match_id: str) -> dict | None:
    raw = await redis_client().hgetall(room_key(match_id))
    if not raw:
        return None
    
    room = { _s(k): _s(v) for k, v in raw.items()}
    room["players"] = json.loads(room["players"])
    room["seed"] = int(room["seed"])
    return room

async def room_of_player(user_id: str) -> str | None:
    """Which match is this player in? the reconnection lookup"""
    value = await redis_client().get(player_key(user_id))
    return _s(value) if value else None

async def set_status(match_id: str, status: str) -> None:
    await redis_client().hset(room_key(match_id), "status", status)
    
async def drop_room(match_id: str) -> None:
    room = await get_room(match_id)
    r = redis_client()
    pipe = r.pipeline()
    pipe.delete(room_key(match_id))
    for pid in (room["players"] if room else []):
        pipe.delete(player_key(pid))
    await pipe.execute()
    

    