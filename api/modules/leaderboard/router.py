from fastapi import APIRouter, HTTPException, Query

from .board import rank_of, rebuild_from_postgres, snapshot, top

router = APIRouter(prefix="/leaderboard", tags=["leaderboard"])

_TIERS = {"beginner", "intermediate", "advanced"}


def _check(tier: str) -> None:
    if tier not in _TIERS:
        raise HTTPException(404, f"unknown tier {tier!r}")


@router.get("/{tier}")
async def board(tier: str,
                limit: int = Query(50, ge=1, le=200),
                weekly: bool = False):
    _check(tier)
    return {"tier": tier, "scope": "weekly" if weekly else "global",
            "entries": await top(tier, limit, weekly)}


@router.get("/{tier}/rank/{user_id}")
async def my_rank(tier: str, user_id: str, weekly: bool = False):
    _check(tier)
    found = await rank_of(user_id, tier, weekly)
    if found is None:
        raise HTTPException(404, "player is not on this board")
    return {"tier": tier, "user_id": user_id, **found}


# --- operational endpoints (would be auth'd / cron-driven in production) ---

@router.post("/{tier}/rebuild")
async def rebuild(tier: str):
    _check(tier)
    return {"tier": tier, "players": await rebuild_from_postgres(tier)}


@router.post("/{tier}/snapshot")
async def take_snapshot(tier: str, weekly: bool = False):
    _check(tier)
    return {"tier": tier, "rows": await snapshot(tier, weekly)}
