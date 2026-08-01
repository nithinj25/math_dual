import time
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from modules.ratings import finalize_match

from .registry import DuelNotFound, create_duel, evict_duel, get_duel
from .state import COUNTDOWN_MS, Duel, DuelStatus, IllegalActions
from .room import create_room, drop_room, get_room, room_of_player, set_status

router = APIRouter(prefix="/internal/duels", tags=["duels"])

class CreateDuelRequest(BaseModel):
    match_id: str
    seed: int
    tier: str
    player_ids: list[str]
    duration_seconds: int = 120
    
class AnswerRequest(BaseModel):
    player_id: str
    q_index: int
    value: int
    
class RttRequest(BaseModel):
    player_id: str
    rtt_ms: float
    
def _get(match_id: str) -> Duel:
    try: 
        return get_duel(match_id)
    except DuelNotFound:
        raise HTTPException(404, f"no live duel {match_id}")
    
def _state(duel: Duel) -> dict:
    return {
        "match_id": duel.match_id,
        "status": duel.status.value,
        "scores": {pid: p.score for pid, p in duel.players.items()},
    }
    
@router.post("")
async def create(req: CreateDuelRequest):
    try:
        duel = create_duel(req.match_id, req.seed, req.tier,
                           req.player_ids, req.duration_seconds)
    except IllegalActions as e:
        raise HTTPException(409, str(e))
    await create_room(req.match_id, req.tier, req.seed, req.player_ids)
    return {**_state(duel), "tier": duel.tier,
            "question_count": len(duel.questions)}


# NOTE: these must stay ABOVE the "/{match_id}/..." routes. FastAPI matches
# in declaration order, so declared later "rooms" would be swallowed as a
# match_id and these would never be reached.

@router.get("/rooms/by-player/{user_id}")
async def my_room(user_id: str):
    """Which match is this player in? Used by a reconnecting gateway."""
    match_id = await room_of_player(user_id)
    if match_id is None:
        raise HTTPException(404, "not in a match")
    found = await get_room(match_id)
    if found is None:
        raise HTTPException(404, "room expired")
    return found


@router.get("/rooms/{match_id}")
async def room(match_id: str):
    found = await get_room(match_id)
    if found is None:
        raise HTTPException(404, "no such room")
    return found


@router.post("/{match_id}/countdown")
def countdown(match_id: str):
    duel = _get(match_id)
    try:
        duel.begin_countdown(time.time())
    except IllegalActions as e:
        raise HTTPException(409, str(e))
    
    return {**_state(duel), "starts_in_ms" : COUNTDOWN_MS}

@router.post("/{match_id}/tick")
def tick(match_id: str):
    duel = _get(match_id)
    duel.tick(time.time())
    return _state(duel)

@router.get("/{match_id}/questions/{player_id}")
def question(match_id: str, player_id: str):
    duel = _get(match_id)
    player = duel.players.get(player_id)
    if player is None:
        raise HTTPException(404, "not a player in this duel")
    if player.position >= len(duel.questions):
        return {"done": True}
    
    q = duel.questions[player.position]
    now = time.time()
    duel.mark_served(player_id, now)
    return { "q_index": q.q_index, "prompt": q.prompt, "served_ts": now}

@router.post("/{match_id}/answer")
def answer(match_id: str, req: AnswerRequest):
    duel = _get(match_id)
    try:
        correct = duel.submit_answer(req.player_id, req.q_index, req.value, time.time())
    except IllegalActions as e:
        raise HTTPException(409, str(e))
    return { **_state(duel), "correct": correct,
            "position": duel.players[req.player_id].position}
    
@router.post("/{match_id}/rtt")
def rtt(match_id: str, req: RttRequest):
    duel = _get(match_id)
    player = duel.players.get(req.player_id)
    if player is None:
        raise HTTPException(404, "not a player in this duel")
    player.rtt_ms = req.rtt_ms
    return {"player_id": req.player_id, "rtt_ms": player.rtt_ms}

@router.get("/{match_id}/result")
def result(match_id: str):
    duel = _get(match_id)
    try:
        return duel.result()
    except IllegalActions as e:
        raise HTTPException(409, str(e))
    
@router.post("/{match_id}/finalize")
async def finalize(match_id: str):
    """Rate a finished duel: match row + both ratings + both history rows,
    all in one transaction."""
    duel = _get(match_id)
    if duel.status is not DuelStatus.FINISHED:
        raise HTTPException(409, f"duel is {duel.status.value}, not finished")

    outcome = duel.result()
    p1, p2 = list(duel.players.values())
    started = (datetime.fromtimestamp(duel.started_at, tz=timezone.utc)
               if duel.started_at is not None else None)

    return await finalize_match(
        match_id=duel.match_id, tier=duel.tier, seed=duel.seed,
        p1=p1.player_id, p2=p2.player_id,
        p1_score=p1.score, p2_score=p2.score,
        winner=outcome["winner"], started_at=started,
    )
    
@router.delete("/{match_id}")
async def close(match_id: str):
    evict_duel(match_id)
    await drop_room(match_id)
    return {"evicted": match_id}

