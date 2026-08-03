import random
from uuid import uuid4

from fastapi import APIRouter
from pydantic import BaseModel

from db import pg_pool
from modules.game.registry import create_duel
from modules.game.room import create_room, get_room, room_of_player

from .queue import find_or_wait, leave, rating_and_tier, size, window_for

router = APIRouter(prefix="/internal/matchmaking", tags=["matchmaking"])

class JoinRequest(BaseModel):
    user_id: str
    waited_seconds: float = 0.0
    
class LeaveRequest(BaseModel):
    user_id: str
    tier: str
    
async def _names(user_ids: list[str]) -> dict[str, str]:
    pool = pg_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, username FROM users WHERE id = ANY($1::uuid[])", user_ids)
    return { str(r["id"]): r["username"] for r in rows}

@router.post("/join")
async def join(req: JoinRequest):
    #Already paired by somebody elses poll ? just report the room 
    existing = await room_of_player(req.user_id)
    if existing is not None:
        return { "matched": True, "match_id": existing,
                "room": await get_room(existing)}
    
    tier, rating = await rating_and_tier(req.user_id)
    opponent = await find_or_wait(req.user_id, tier, rating, req.waited_seconds)
    if opponent is None:
        return {"matched": False, "tier": tier, "rating": rating,
                "window": window_for(req.waited_seconds)}
        
    match_id = f"m_{uuid4().hex[:8]}"
    seed = random.getrandbits(31)
    players = [req.user_id, opponent]
    create_duel(match_id, seed, tier, players)
    await create_room(match_id, tier, seed, players, await _names(players))

    return {"matched": True, "match_id": match_id, "opponent": opponent,
            "room": await get_room(match_id)}
    
@router.post("/leave")
async def leave_queue(req: LeaveRequest):
    return {"removed": await leave(req.user_id, req.tier)}


@router.get("/size/{tier}")
async def queue_size(tier: str):
    return {"tier": tier, "waiting": await size(tier)}


        