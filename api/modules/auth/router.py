from fastapi import APIRouter, HTTPException
from pydantic import BaseModel


from .dependencies import get_or_create_user
from .token import InvalidToken, verify_token



router = APIRouter(prefix="/internal/auth", tags=["auth"])

class ResolveRequest(BaseModel):
    token: str
    
@router.post("/resolve")
async def resolve(req: ResolveRequest):
    """Gateway calls this on join: token in , real user identity out."""
    try:
        identity = verify_token(req.token)
    except InvalidToken as e:
        raise HTTPException(401, str(e))
    user = await get_or_create_user(identity)
    return {"user_id": str(user["id"]), "username": user["username"]}

