from fastapi import APIRouter
from pydantic import BaseModel

from .queue import find_or_wait, leave, rating_and_tier, size, window_for

router = APIRouter(prefix="/internal/matchmaking", tags=["matchmaking"])

class JoinRequest(BaseModel):
    user_id: str
    waited_seconds: float = 0.0
    
class LeaveRequest(BaseModel):
    user_id: str
    tier: str
    
@router.post("/join")
async def join(req: JoinRequest):
    tier, rating = await rating_and_tier(req.user_id)
    opponent = await find_or_wait(req.user_id, tier, rating, req.waited_seconds)
    return { "matched": opponent is not None, "opponent": opponent,
            "tier": tier, "rating": rating,
            "window": window_for(req.waited_seconds)}
    
@router.post("/leave")
async def leave_queue(req: LeaveRequest):
    return {"removed": await leave(req.user_id, req.tier)}

@router.get("/size/{tier}")
async def queue_size(tier: str):
    return {"tier": tier, "waiting": await size(tier)}


    